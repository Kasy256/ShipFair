import type RAPIER from '@dimforge/rapier3d-compat';
import { type CityLayout, type District, type Rect, STREET_W_M } from '@shipfair/shared';
import {
  type BufferAttribute,
  Group,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Texture,
} from 'three';
import { GROUND_MARGIN_M } from '../config.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import { districtFrame, ringRoad } from './city-geometry.ts';
import { LABEL_ASPECT, type LabelAtlas } from './labels.ts';
import { StaticMerger } from './static-merge.ts';
import { groundTexture } from './textures.ts';
import { type DistrictTheme, themeFor } from './themes.ts';

// The city's ground and streets (rebuilt when a district grows a street), its district gates,
// and the colliders that hold the world together.

const GRASS = 0x6f9a52;
const ASPHALT = 0x50545d;
const PLAZA = 0xd9d1c3;
const GRASS_TILE_M = 10;
/** Grass sits a little under everything and is split into cells (see `groundQuad`). */
const GRASS_Y_M = -0.03;
const GRASS_CELL_M = 40;
const ASPHALT_TILE_M = 8;
const PLAZA_TILE_M = 6;
// Ground layers draw over each other with polygon offsets (no z-fighting at any distance).
const LAYER = { grass: 0, district: -1, street: -2, plaza: -2 } as const;
const GATE_HEIGHT_M = 5;
const PILLAR_M = 0.7;
const BEAM_M = 0.6;
const PANEL_H_M = 1.1;
const GLOW_INTENSITY = 2.4;
/** The floor collider; far bigger than any city so growth never outruns it. */
const FLOOR_HALF_M = 4000;
const EDGE_WALL_H_M = 6;

/**
 * A flat quad over `rect` at height `y` with world-space UVs (`tileM` metres per texture repeat).
 * Big quads are split into cells of about `cellM`: depth interpolated across a kilometre-wide
 * triangle clipped by the near plane is too coarse for the polygon offsets between layers.
 */
function groundQuad(
  rect: Rect,
  tileM: number,
  y = 0,
  cellM = Number.POSITIVE_INFINITY,
): PlaneGeometry {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  const cells = (size: number) => Math.max(1, Math.ceil(size / cellM));
  const geometry = new PlaneGeometry(w, d, cells(w), cells(d))
    .rotateX(-Math.PI / 2)
    .translate((rect.minX + rect.maxX) / 2, y, (rect.minZ + rect.maxZ) / 2);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv') as BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, position.getX(i) / tileM, -position.getZ(i) / tileM);
  }
  return geometry;
}

function groundMaterial(map: Texture, color: number, layer: number, roughness = 0.9): Material {
  const material = new MeshStandardMaterial({ map, color, roughness, metalness: 0 });
  material.polygonOffset = layer !== 0;
  material.polygonOffsetFactor = layer;
  material.polygonOffsetUnits = layer;
  return material;
}

/** Ground, plaza paving and streets. `rebuild` replaces the meshes; materials are kept. */
export class CityGround {
  readonly root = new Group();
  readonly #textures = new Map<string, Texture>();
  readonly #materials = new Map<string, Material>();
  #meshes: Mesh[] = [];

  constructor() {
    this.root.name = 'city-ground';
  }

  rebuild(layout: CityLayout): void {
    this.#clear();
    const b = layout.bounds;
    const m = GROUND_MARGIN_M;
    const merger = new StaticMerger();
    const grass = this.#material('grass', 'grass', GRASS, LAYER.grass);
    merger.add(
      grass,
      groundQuad(
        { minX: b.minX - m, minZ: b.minZ - m, maxX: b.maxX + m, maxZ: b.maxZ + m },
        GRASS_TILE_M,
        GRASS_Y_M,
        GRASS_CELL_M,
      ),
      [0, 0, 0],
    );
    const plaza = this.#material('plaza', 'pavers', PLAZA, LAYER.plaza);
    merger.add(plaza, groundQuad(layout.plaza.rect, PLAZA_TILE_M), [0, 0, 0]);
    const asphalt = this.#material('asphalt', 'asphalt', ASPHALT, LAYER.street);
    for (const rect of ringRoad(layout))
      merger.add(asphalt, groundQuad(rect, ASPHALT_TILE_M), [0, 0, 0]);
    for (const district of layout.districts) {
      const theme = themeFor(district.theme);
      const ground = this.#themeMaterial(theme);
      merger.add(ground, groundQuad(district.rect, theme.ground.tileM), [0, 0, 0]);
      for (const street of district.streets) {
        merger.add(asphalt, groundQuad(street, ASPHALT_TILE_M), [0, 0, 0]);
      }
    }
    for (const material of this.#materials.values()) merger.castShadow(material, false);
    this.#meshes = merger.build(this.root, 'ground');
  }

  dispose(): void {
    this.#clear();
    for (const material of this.#materials.values()) material.dispose();
    for (const texture of this.#textures.values()) texture.dispose();
    this.#materials.clear();
    this.#textures.clear();
    this.root.removeFromParent();
  }

  #clear(): void {
    for (const mesh of this.#meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.#meshes = [];
  }

  #texture(pattern: Parameters<typeof groundTexture>[0]): Texture {
    let texture = this.#textures.get(pattern);
    if (!texture) {
      texture = groundTexture(pattern);
      this.#textures.set(pattern, texture);
    }
    return texture;
  }

  #material(
    key: string,
    pattern: Parameters<typeof groundTexture>[0],
    color: number,
    layer: number,
  ): Material {
    let material = this.#materials.get(key);
    if (!material) {
      material = groundMaterial(this.#texture(pattern), color, layer);
      material.name = key;
      this.#materials.set(key, material);
    }
    return material;
  }

  #themeMaterial(theme: DistrictTheme): Material {
    const key = `district:${theme.key}`;
    let material = this.#materials.get(key);
    if (!material) {
      const g = theme.ground;
      const standard = new MeshStandardMaterial({
        map: this.#texture(g.pattern),
        color: g.color,
        roughness: g.roughness,
        metalness: g.metalness,
        polygonOffset: true,
        polygonOffsetFactor: LAYER.district,
        polygonOffsetUnits: LAYER.district,
      });
      standard.name = key;
      material = standard;
      this.#materials.set(key, material);
    }
    return material;
  }
}

/** Materials for gates, signposts and plaza furniture (one merged mesh each). */
export interface StaticMaterials {
  /** Lit, tinted by vertex colour. */
  readonly solid: MeshStandardMaterial;
  /** Unlit and bright enough to bloom, tinted by vertex colour. */
  readonly glow: MeshBasicMaterial;
  /** Label panels from the label atlas. */
  readonly labels: MeshBasicMaterial;
}

export function createStaticMaterials(atlas: LabelAtlas): StaticMaterials {
  const solid = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 });
  solid.name = 'static-solid';
  const glow = new MeshBasicMaterial({ vertexColors: true });
  glow.color.setScalar(GLOW_INTENSITY);
  glow.name = 'static-glow';
  const labels = new MeshBasicMaterial({ map: atlas.texture });
  labels.name = 'static-labels';
  return { solid, glow, labels };
}

/**
 * A gate over each district's spine street where it meets the ring road: two pillars, a beam,
 * a glow strip in the district colour and the district name on both faces. `labelIndex` maps a
 * district id to its label in the atlas.
 */
export function buildGates(
  merger: StaticMerger,
  materials: StaticMaterials,
  layout: CityLayout,
  districts: ReadonlyMap<number, District>,
  atlas: LabelAtlas,
  labelIndex: ReadonlyMap<number, number>,
  physics: PhysicsWorld,
): RAPIER.Collider[] {
  const colliders: RAPIER.Collider[] = [];
  const span = STREET_W_M + PILLAR_M * 2;
  for (const district of layout.districts) {
    const theme = themeFor(district.theme);
    const color = Number.parseInt((districts.get(district.id)?.color ?? '#ffffff').slice(1), 16);
    const f = districtFrame(district);
    const { entrance: e, lateral: l, outward: o } = f;
    // A box's local x turned by the outward yaw runs along the lateral axis: across the street.
    const beamYaw = f.yaw;
    for (const side of [-1, 1]) {
      const reach = STREET_W_M / 2 + PILLAR_M / 2;
      const x = e.x + l.x * side * reach;
      const z = e.z + l.z * side * reach;
      merger.box(materials.solid, [PILLAR_M, GATE_HEIGHT_M, PILLAR_M], [x, 0, z], 0, theme.gate);
      colliders.push(
        physics.addBox(
          { x, y: GATE_HEIGHT_M / 2, z },
          { x: PILLAR_M / 2, y: GATE_HEIGHT_M / 2, z: PILLAR_M / 2 },
        ),
      );
    }
    merger.box(
      materials.solid,
      [span, BEAM_M, BEAM_M],
      [e.x, GATE_HEIGHT_M, e.z],
      beamYaw,
      theme.gate,
    );
    merger.box(
      materials.glow,
      [span, 0.08, 0.12],
      [e.x, GATE_HEIGHT_M - 0.08, e.z],
      beamYaw,
      color,
    );
    const index = labelIndex.get(district.id);
    if (index === undefined) continue;
    const w = PANEL_H_M * LABEL_ASPECT;
    const y = GATE_HEIGHT_M - PANEL_H_M / 2 - 0.15;
    const out = BEAM_M / 2 + 0.02;
    // Facing the plaza (−outward) and facing out of town (+outward, read when leaving).
    for (const dir of [-1, 1]) {
      const yaw = dir < 0 ? f.yaw + Math.PI : f.yaw;
      merger.plane(
        materials.labels,
        w,
        PANEL_H_M,
        [e.x + o.x * out * dir, y, e.z + o.z * out * dir],
        yaw,
        atlas.rect(index),
      );
    }
  }
  return colliders;
}

/** The floor everything stands on and low walls round the edge of the grass. */
export function addWorldColliders(physics: PhysicsWorld, layout: CityLayout): RAPIER.Collider[] {
  const b = layout.bounds;
  const m = GROUND_MARGIN_M;
  const minX = b.minX - m;
  const maxX = b.maxX + m;
  const minZ = b.minZ - m;
  const maxZ = b.maxZ + m;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const hx = (maxX - minX) / 2;
  const hz = (maxZ - minZ) / 2;
  const h = EDGE_WALL_H_M / 2;
  return [
    physics.addBox({ x: 0, y: -1, z: 0 }, { x: FLOOR_HALF_M, y: 1, z: FLOOR_HALF_M }),
    physics.addBox({ x: cx, y: h, z: minZ }, { x: hx, y: h, z: 0.5 }),
    physics.addBox({ x: cx, y: h, z: maxZ }, { x: hx, y: h, z: 0.5 }),
    physics.addBox({ x: minX, y: h, z: cz }, { x: 0.5, y: h, z: hz }),
    physics.addBox({ x: maxX, y: h, z: cz }, { x: 0.5, y: h, z: hz }),
  ];
}
