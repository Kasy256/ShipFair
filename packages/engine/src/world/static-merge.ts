import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type V3 = readonly [number, number, number];

/** A sub-rectangle of a texture, in UV space (v up). */
export interface UvRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

const up = new Vector3(0, 1, 0);
const q = new Quaternion();
const p = new Vector3();
const s = new Vector3();
const tint = new Color();

/**
 * Collects static pieces (boxes, planes, any geometry) and merges them into one mesh per material
 * at build time (ARCHITECTURE.md §4: static environment geometry is merged per material).
 */
export class StaticMerger {
  readonly #parts = new Map<Material, BufferGeometry[]>();
  readonly #shadows = new Map<Material, boolean>();

  /** A box with its bottom centre at `base`, turned `yaw` about +Y, tinted `color`. */
  box(material: Material, size: V3, base: V3, yaw = 0, color = 0xffffff): void {
    const geometry = new BoxGeometry(size[0], size[1], size[2]).translate(0, size[1] / 2, 0);
    this.add(material, geometry, base, yaw, color);
  }

  /** A plane facing +Z (turned by `yaw`) centred on `center`, optionally showing `uv` of its map. */
  plane(
    material: Material,
    w: number,
    h: number,
    center: V3,
    yaw = 0,
    uv?: UvRect,
    color = 0xffffff,
  ): void {
    const geometry = new PlaneGeometry(w, h);
    if (uv) {
      const attribute = geometry.getAttribute('uv');
      for (let i = 0; i < attribute.count; i++) {
        attribute.setXY(
          i,
          uv.u0 + attribute.getX(i) * (uv.u1 - uv.u0),
          uv.v0 + attribute.getY(i) * (uv.v1 - uv.v0),
        );
      }
    }
    this.add(material, geometry, center, yaw, color);
  }

  /**
   * Takes ownership of `geometry`, placed at `position` and turned `yaw`. Every piece gets a
   * `color` attribute (`color`), which materials with `vertexColors` multiply in.
   */
  add(material: Material, geometry: BufferGeometry, position: V3, yaw = 0, color = 0xffffff): void {
    const matrix = new Matrix4().compose(
      p.set(position[0], position[1], position[2]),
      q.setFromAxisAngle(up, yaw),
      s.set(1, 1, 1),
    );
    geometry.applyMatrix4(matrix);
    // Indexed and non-indexed pieces can't merge together, so everything goes non-indexed.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    for (const name of Object.keys(flat.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') flat.deleteAttribute(name);
    }
    tint.setHex(color);
    const count = flat.getAttribute('position').count;
    const rgb = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) tint.toArray(rgb, i * 3);
    flat.setAttribute('color', new BufferAttribute(rgb, 3));
    flat.clearGroups();
    const list = this.#parts.get(material);
    if (list) list.push(flat);
    else this.#parts.set(material, [flat]);
  }

  castShadow(material: Material, cast: boolean): void {
    this.#shadows.set(material, cast);
  }

  /** One mesh per material, added to `parent`. The caller disposes their geometries. */
  build(parent: Object3D, name: string): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [material, parts] of this.#parts) {
      const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
      if (!merged) continue;
      if (merged !== parts[0]) for (const part of parts) part.dispose();
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, material);
      mesh.name = `${name}/${material.name || material.type}`;
      mesh.castShadow = this.#shadows.get(material) ?? true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.#parts.clear();
    return meshes;
  }
}
