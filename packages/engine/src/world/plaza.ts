import type RAPIER from '@dimforge/rapier3d-compat';
import { APP_NAME, type CityLayout } from '@shipfair/shared';
import {
  CanvasTexture,
  type Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PhysicsWorld } from '../physics/world.ts';
import { blockFont, blockText } from './block-font.ts';
import type { StaticMaterials } from './build-city.ts';
import { districtFrame } from './city-geometry.ts';
import { LABEL_ASPECT, type LabelAtlas } from './labels.ts';
import type { StaticMerger } from './static-merge.ts';
import { context2d, createCanvas } from './textures.ts';

// The plaza (ARCHITECTURE.md §4): spawn at the origin facing north (+z), the brand letters ahead,
// the "Claim a booth" kiosk between them, the Just Launched wall behind and a signpost by every
// district entrance. Everything sits clear of the straight lines from the spawn to each gate.

const LETTERS = { z: 18, size: 3.2, depth: 1, plinthH: 0.6 } as const;
const KIOSK = { x: 0, z: 9 } as const;
const WALL = { z: -16, w: 12, h: 6, y: 0.8 } as const;
const BRAND_VIOLET = 0x7c5cff;
const BRAND_TEAL = 0x00e5c7;
const INK = 0x0d0f17;
const POST_M = 0.18;
/** Signposts stand this far back from a gate and this far across from its spine street. */
const SIGNPOST_BACK_M = 4;
const SIGNPOST_ACROSS_M = 5;
const BOARD_W_M = 3;

/** The "Just Launched" screen: a canvas the UI data feeds (names only, drawn as text). */
export class JustLaunchedWall {
  readonly mesh: Mesh;
  readonly #canvas = createCanvas(1024, 512);
  readonly #texture = new CanvasTexture(this.#canvas);

  constructor(parent: Group) {
    this.#texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: this.#texture });
    this.mesh = new Mesh(new PlaneGeometry(WALL.w, WALL.h), material);
    this.mesh.name = 'just-launched';
    this.mesh.position.set(0, WALL.y + WALL.h / 2, WALL.z + 0.26);
    parent.add(this.mesh);
    this.show([]);
  }

  /** Newest first. An empty list shows the placeholder. */
  show(names: readonly string[]): void {
    const ctx = context2d(this.#canvas);
    const { width: w, height: h } = this.#canvas;
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, '#120c33');
    gradient.addColorStop(1, '#0b3d47');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 64px "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.fillText('JUST LAUNCHED', 48, 72);
    ctx.fillStyle = '#00e5c7';
    ctx.fillRect(48, 112, 220, 8);
    ctx.font = '700 40px "Segoe UI", Helvetica, Arial, sans-serif';
    if (names.length === 0) {
      ctx.fillStyle = '#c9c4ff';
      ctx.fillText('New booths appear here.', 48, 200);
    }
    names.slice(0, 6).forEach((name, i) => {
      ctx.fillStyle = i === 0 ? '#ffd23f' : '#e9e6ff';
      ctx.fillText(`${i + 1}.  ${name}`, 48, 180 + i * 54, w - 96);
    });
    this.#texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.#texture.dispose();
  }
}

export interface Plaza {
  readonly spawn: { readonly x: number; readonly z: number; readonly yaw: number };
  readonly kiosk: { readonly x: number; readonly z: number };
  readonly wall: JustLaunchedWall;
  readonly colliders: RAPIER.Collider[];
  dispose(): void;
}

export interface PlazaLabels {
  readonly atlas: LabelAtlas;
  /** District id → label index (its name). */
  readonly districts: ReadonlyMap<number, number>;
  readonly kiosk: number;
}

export function buildPlaza(
  parent: Group,
  merger: StaticMerger,
  materials: StaticMaterials,
  layout: CityLayout,
  labels: PlazaLabels,
  physics: PhysicsWorld,
): Plaza {
  const colliders: RAPIER.Collider[] = [];
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number) =>
    colliders.push(physics.addBox({ x, y, z }, { x: hx, y: hy, z: hz }));

  // Brand letters on a plinth, facing the spawn (a half turn, so they read left to right).
  // ExtrudeGeometry emits a group per glyph piece (a draw call each); merge to faces + sides.
  const geometry = mergeGroups(
    new TextGeometry(blockText(APP_NAME), {
      font: blockFont(),
      size: LETTERS.size,
      depth: LETTERS.depth,
      curveSegments: 1,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.05,
      bevelSegments: 1,
    }),
  );
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const width = bb ? bb.max.x - bb.min.x : 0;
  geometry.translate(-(bb ? (bb.max.x + bb.min.x) / 2 : 0), 0, -LETTERS.depth / 2);
  const face = new MeshStandardMaterial({ color: 0xe9eaf2, roughness: 0.35, metalness: 0.2 });
  const side = new MeshStandardMaterial({
    color: BRAND_VIOLET,
    emissive: BRAND_VIOLET,
    emissiveIntensity: 0.6,
    roughness: 0.3,
    metalness: 0.3,
  });
  const letters = new Mesh(geometry, [face, side]);
  letters.name = 'brand-letters';
  letters.position.set(0, LETTERS.plinthH, LETTERS.z);
  letters.rotation.y = Math.PI;
  letters.castShadow = true;
  letters.receiveShadow = true;
  parent.add(letters);
  const plinthW = width + 2;
  merger.box(materials.solid, [plinthW, LETTERS.plinthH, 3], [0, 0, LETTERS.z], 0, 0x26282f);
  merger.box(
    materials.glow,
    [plinthW, 0.06, 0.08],
    [0, LETTERS.plinthH, LETTERS.z - 1.52],
    0,
    BRAND_TEAL,
  );
  const lettersH = LETTERS.plinthH + LETTERS.size;
  box(0, lettersH / 2, LETTERS.z, plinthW / 2, lettersH / 2, 1.5);

  // "Claim a booth" kiosk: counter, glowing top and a label on a post, facing the spawn.
  merger.box(materials.solid, [1.8, 1.1, 0.9], [KIOSK.x, 0, KIOSK.z], 0, 0xff6b3d);
  merger.box(materials.glow, [1.8, 0.06, 0.9], [KIOSK.x, 1.1, KIOSK.z], 0, BRAND_TEAL);
  merger.box(materials.solid, [POST_M, 3.2, POST_M], [KIOSK.x, 0, KIOSK.z + 0.3], 0, INK);
  const kioskW = 2.6;
  merger.plane(
    materials.labels,
    kioskW,
    kioskW / LABEL_ASPECT,
    [KIOSK.x, 2.9, KIOSK.z + 0.18],
    Math.PI,
    labels.atlas.rect(labels.kiosk),
  );
  box(KIOSK.x, 0.55, KIOSK.z, 0.9, 0.55, 0.45);

  // Just Launched wall: a dark frame behind the screen, facing the spawn from the south.
  const wall = new JustLaunchedWall(parent);
  merger.box(
    materials.solid,
    [WALL.w + 0.6, WALL.h + WALL.y + 0.3, 0.4],
    [0, 0, WALL.z],
    0,
    0x1b1d26,
  );
  merger.box(
    materials.glow,
    [WALL.w + 0.6, 0.08, 0.1],
    [0, WALL.y - 0.2, WALL.z + 0.25],
    0,
    BRAND_VIOLET,
  );
  const wallH = WALL.h + WALL.y + 0.3;
  box(0, wallH / 2, WALL.z, (WALL.w + 0.6) / 2, wallH / 2, 0.2);

  // A signpost by each district gate: post plus a name board facing the plaza.
  for (const district of layout.districts) {
    const index = labels.districts.get(district.id);
    if (index === undefined) continue;
    const f = districtFrame(district);
    const x = f.entrance.x - f.outward.x * SIGNPOST_BACK_M + f.lateral.x * SIGNPOST_ACROSS_M;
    const z = f.entrance.z - f.outward.z * SIGNPOST_BACK_M + f.lateral.z * SIGNPOST_ACROSS_M;
    merger.box(materials.solid, [POST_M, 3.4, POST_M], [x, 0, z], 0, INK);
    const boardH = BOARD_W_M / LABEL_ASPECT;
    merger.plane(
      materials.labels,
      BOARD_W_M,
      boardH,
      [x - f.outward.x * 0.1, 2.9, z - f.outward.z * 0.1],
      f.yaw + Math.PI,
      labels.atlas.rect(index),
    );
    box(x, 1.7, z, POST_M, 1.7, POST_M);
  }

  return {
    spawn: layout.plaza.spawn,
    kiosk: KIOSK,
    wall,
    colliders,
    dispose() {
      letters.removeFromParent();
      geometry.dispose();
      face.dispose();
      side.dispose();
      wall.dispose();
    },
  };
}

/** Plaza planter spots, clear of the spawn-to-gate lines (used by world/greenery.ts). */
export const PLAZA_PLANTERS: readonly (readonly [number, number])[] = [
  [12, 26],
  [-12, 26],
  [26, 12],
  [26, -12],
  [12, -26],
  [-12, -26],
  [-26, 12],
  [-26, -12],
];
