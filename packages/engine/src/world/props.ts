import type RAPIER from '@dimforge/rapier3d-compat';
import type { BuiltProp, ColliderShape, GeneratedAssetManifest } from '@shipfair/shared';
import {
  BoxGeometry,
  type BufferGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  type Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AssetManager, LoadedAsset } from '../assets/asset-manager.ts';
import { floatCopy } from '../assets/geometry.ts';
import type { PaletteMaterials } from '../assets/palette.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import { InstanceSet } from '../render/instance-set.ts';
import type { PropPlacement } from './prop-plan.ts';

interface PropModel {
  readonly geometry: BufferGeometry;
  readonly collider: ColliderShape;
  /** Local bounds (metres) for the collider. */
  readonly min: Vector3;
  readonly max: Vector3;
}

const FALLBACK_SIZE_M = 0.8;
/** Palette UVs default to the centre of the texture when a file has none. */
const PROP_ATTRIBUTES = [
  ['position', 3, 0],
  ['normal', 3, 0],
  ['uv', 2, 0.5],
] as const;
const up = new Vector3(0, 1, 0);
const scratchQ = new Quaternion();
const scratchP = new Vector3();
const scratchS = new Vector3(1, 1, 1);

/** One geometry per prop in the prop's own space (node transforms and dequantization baked in). */
function bake(asset: LoadedAsset): BufferGeometry | null {
  asset.scene.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  asset.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    parts.push(floatCopy(mesh.geometry, PROP_ATTRIBUTES).applyMatrix4(mesh.matrixWorld));
  });
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] ?? null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * Street furniture: one InstancedMesh per prop id on the shared palette material, plus static
 * box or cylinder colliders sized from each prop's bounds. Props whose file is missing show as
 * grey boxes (and are reported through `asset:missing`).
 */
export class PropField {
  readonly #models = new Map<string, PropModel>();
  readonly #materials: PaletteMaterials;

  private constructor(materials: PaletteMaterials) {
    this.#materials = materials;
  }

  static async load(
    assets: AssetManager,
    manifest: GeneratedAssetManifest | null,
    materials: PaletteMaterials,
    ids: readonly string[],
  ): Promise<PropField> {
    const field = new PropField(materials);
    const entries = new Map<string, BuiltProp>(manifest?.props.map((p) => [p.id, p]) ?? []);
    await Promise.all(
      ids.map(async (id) => {
        const entry = entries.get(id);
        const assetId = `prop:${id}`;
        const asset = await assets.load(assetId, entry?.url ?? null, () => ({
          scene: new Group(),
          animations: [],
          isPlaceholder: true,
        }));
        const geometry =
          bake(asset) ??
          new BoxGeometry(FALLBACK_SIZE_M, FALLBACK_SIZE_M, FALLBACK_SIZE_M).translate(
            0,
            FALLBACK_SIZE_M / 2,
            0,
          );
        // The baked copy owns its data, so the file can go.
        assets.release(assetId);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        field.#models.set(id, {
          geometry,
          collider: entry?.collider ?? 'box',
          min: box ? box.min.clone() : new Vector3(),
          max: box ? box.max.clone() : new Vector3(),
        });
      }),
    );
    return field;
  }

  get ids(): string[] {
    return [...this.#models.keys()];
  }

  /** Instanced meshes (and, with `physics`, colliders) for `placements`. */
  build(
    placements: readonly PropPlacement[],
    physics?: PhysicsWorld,
  ): { set: InstanceSet; colliders: RAPIER.Collider[] } {
    const set = new InstanceSet();
    set.group.name = 'props';
    const colliders: RAPIER.Collider[] = [];
    const byId = new Map<string, PropPlacement[]>();
    for (const p of placements) {
      if (!this.#models.has(p.id)) continue;
      byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
    }
    const matrix = new Matrix4();
    for (const [id, list] of byId) {
      const model = this.#models.get(id);
      if (!model) continue;
      const mesh = new InstancedMesh(model.geometry, this.#materials.palette, list.length);
      mesh.name = `prop/${id}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const positions = new Float32Array(list.length * 2);
      list.forEach((p, i) => {
        scratchQ.setFromAxisAngle(up, p.yaw);
        mesh.setMatrixAt(i, matrix.compose(scratchP.set(p.x, 0, p.z), scratchQ, scratchS));
        positions[i * 2] = p.x;
        positions[i * 2 + 1] = p.z;
        if (physics) colliders.push(this.#collider(physics, model, p));
      });
      mesh.computeBoundingSphere();
      set.add(mesh, positions);
    }
    return { set, colliders };
  }

  dispose(): void {
    for (const model of this.#models.values()) model.geometry.dispose();
    this.#models.clear();
  }

  #collider(physics: PhysicsWorld, model: PropModel, p: PropPlacement): RAPIER.Collider {
    const { min, max } = model;
    const hx = (max.x - min.x) / 2;
    const hy = (max.y - min.y) / 2;
    const hz = (max.z - min.z) / 2;
    // Bounds centre in local space, rotated by the placement yaw.
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    const center = {
      x: p.x + cx * cos + cz * sin,
      y: (min.y + max.y) / 2,
      z: p.z - cx * sin + cz * cos,
    };
    if (model.collider === 'cylinder') return physics.addCylinder(center, hy, Math.max(hx, hz));
    scratchQ.setFromAxisAngle(up, p.yaw);
    return physics.addBox(
      center,
      { x: hx, y: hy, z: hz },
      { x: scratchQ.x, y: scratchQ.y, z: scratchQ.z, w: scratchQ.w },
    );
  }
}
