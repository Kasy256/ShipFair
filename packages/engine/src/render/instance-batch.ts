import {
  type BufferGeometry,
  type Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  type Matrix4,
  type Object3D,
} from 'three';

export interface BatchAttribute {
  readonly name: string;
  readonly itemSize: number;
}

export interface BatchOptions {
  readonly name: string;
  readonly hasColor?: boolean;
  /**
   * Extra per-instance attributes (e.g. a sign's atlas cell). The batch then draws a clone of
   * `geometry` that it owns, because instanced attributes live on the geometry.
   */
  readonly attributes?: readonly BatchAttribute[];
  /** Initial instance capacity; the batch doubles it when full. */
  readonly capacity?: number;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

const MIN_CAPACITY = 8;

/**
 * An InstancedMesh whose instances are added, changed and removed by key at runtime, with a
 * draw distance (ARCHITECTURE.md §4). Instances live in source arrays; `cull` and `flush` pack the
 * ones within range to the front of the GPU buffers. Packing, `setMatrix` and `setColor` are
 * allocation-free; only growth (doubling the capacity) allocates.
 */
export class InstanceBatch {
  readonly #parent: Object3D;
  readonly #source: BufferGeometry;
  readonly #material: Material;
  readonly #options: BatchOptions;
  readonly #slots = new Map<string, number>();
  #keys: string[] = [];
  #mesh!: InstancedMesh;
  #ownGeometry: BufferGeometry | null = null;
  #capacity = 0;
  #count = 0;
  #matrices = new Float32Array(0);
  #colors = new Float32Array(0);
  #positions = new Float32Array(0);
  #extras: Float32Array[] = [];
  #isDirty = true;
  #x = 0;
  #z = 0;
  #radius = Number.POSITIVE_INFINITY;

  constructor(
    parent: Object3D,
    geometry: BufferGeometry,
    material: Material,
    options: BatchOptions,
  ) {
    this.#parent = parent;
    this.#source = geometry;
    this.#material = material;
    this.#options = options;
    this.#grow(Math.max(MIN_CAPACITY, options.capacity ?? MIN_CAPACITY));
  }

  get mesh(): InstancedMesh {
    return this.#mesh;
  }

  /** Instances stored (drawn or not). */
  get size(): number {
    return this.#count;
  }

  /** Instances drawn after the last pack. */
  get drawn(): number {
    return this.#mesh.count;
  }

  has(key: string): boolean {
    return this.#slots.has(key);
  }

  /** Adds or replaces the instance `key` at ground position (x, z), used for the draw distance. */
  set(
    key: string,
    matrix: Matrix4,
    x: number,
    z: number,
    color?: Color,
    extra?: readonly (readonly number[])[],
  ): void {
    let slot = this.#slots.get(key);
    if (slot === undefined) {
      if (this.#count === this.#capacity) this.#grow(this.#capacity * 2);
      slot = this.#count++;
      this.#slots.set(key, slot);
      this.#keys[slot] = key;
    }
    matrix.toArray(this.#matrices, slot * 16);
    this.#positions[slot * 2] = x;
    this.#positions[slot * 2 + 1] = z;
    if (color && this.#options.hasColor) color.toArray(this.#colors, slot * 3);
    if (extra) {
      this.#extras.forEach((array, a) => {
        const size = this.#options.attributes?.[a]?.itemSize ?? 0;
        const values = extra[a];
        for (let k = 0; k < size; k++) array[slot * size + k] = values?.[k] ?? 0;
      });
    }
    this.#isDirty = true;
  }

  setMatrix(key: string, matrix: Matrix4): void {
    const slot = this.#slots.get(key);
    if (slot === undefined) return;
    matrix.toArray(this.#matrices, slot * 16);
    this.#isDirty = true;
  }

  setColor(key: string, color: Color): void {
    const slot = this.#slots.get(key);
    if (slot === undefined || !this.#options.hasColor) return;
    color.toArray(this.#colors, slot * 3);
    this.#isDirty = true;
  }

  /** Removes `key`; the last instance moves into its slot. */
  remove(key: string): void {
    const slot = this.#slots.get(key);
    if (slot === undefined) return;
    const last = --this.#count;
    this.#slots.delete(key);
    if (slot !== last) {
      const moved = this.#keys[last] ?? '';
      this.#matrices.copyWithin(slot * 16, last * 16, last * 16 + 16);
      this.#colors.copyWithin(slot * 3, last * 3, last * 3 + 3);
      this.#positions.copyWithin(slot * 2, last * 2, last * 2 + 2);
      this.#extras.forEach((array, a) => {
        const size = this.#options.attributes?.[a]?.itemSize ?? 0;
        array.copyWithin(slot * size, last * size, last * size + size);
      });
      this.#keys[slot] = moved;
      this.#slots.set(moved, slot);
    }
    this.#keys.length = last;
    this.#isDirty = true;
  }

  /** Draws only instances within `radius` metres of (x, z). */
  cull(x: number, z: number, radius: number): void {
    this.#x = x;
    this.#z = z;
    const isSame = radius === Number.POSITIVE_INFINITY && this.#radius === radius;
    this.#radius = radius;
    if (isSame && !this.#isDirty) return;
    this.#pack();
  }

  /** Re-packs with the last cull centre if anything changed since. */
  flush(): void {
    if (this.#isDirty) this.#pack();
  }

  dispose(): void {
    this.#mesh.removeFromParent();
    this.#mesh.dispose();
    this.#ownGeometry?.dispose();
    this.#ownGeometry = null;
  }

  #pack(): void {
    this.#isDirty = false;
    const mesh = this.#mesh;
    const dst = mesh.instanceMatrix.array as Float32Array;
    const dstColor = mesh.instanceColor?.array as Float32Array | undefined;
    const geometry = mesh.geometry;
    const r2 = this.#radius * this.#radius;
    let n = 0;
    for (let i = 0; i < this.#count; i++) {
      const dx = (this.#positions[i * 2] ?? 0) - this.#x;
      const dz = (this.#positions[i * 2 + 1] ?? 0) - this.#z;
      if (dx * dx + dz * dz > r2) continue;
      // Plain loops: subarray() would allocate a view per instance.
      for (let k = 0; k < 16; k++) dst[n * 16 + k] = this.#matrices[i * 16 + k] ?? 0;
      if (dstColor) for (let k = 0; k < 3; k++) dstColor[n * 3 + k] = this.#colors[i * 3 + k] ?? 0;
      for (let a = 0; a < this.#extras.length; a++) {
        const spec = this.#options.attributes?.[a];
        const src = this.#extras[a];
        if (!spec || !src) continue;
        const out = geometry.getAttribute(spec.name).array as Float32Array;
        const s = spec.itemSize;
        for (let k = 0; k < s; k++) out[n * s + k] = src[i * s + k] ?? 0;
      }
      n++;
    }
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    for (const spec of this.#options.attributes ?? []) {
      geometry.getAttribute(spec.name).needsUpdate = true;
    }
  }

  /** Reallocates for `capacity` instances. The mesh is rebuilt so old GPU buffers are freed. */
  #grow(capacity: number): void {
    const copy = (old: Float32Array, size: number) => {
      const next = new Float32Array(capacity * size);
      next.set(old.subarray(0, Math.min(old.length, capacity * size)));
      return next;
    };
    this.#matrices = copy(this.#matrices, 16);
    this.#colors = copy(this.#colors, 3);
    this.#positions = copy(this.#positions, 2);
    const attributes = this.#options.attributes ?? [];
    this.#extras = attributes.map((a, i) =>
      copy(this.#extras[i] ?? new Float32Array(0), a.itemSize),
    );
    this.#capacity = capacity;

    let geometry = this.#source;
    if (attributes.length > 0) {
      this.#ownGeometry?.dispose();
      geometry = this.#source.clone();
      for (const a of attributes) {
        const attribute = new InstancedBufferAttribute(
          new Float32Array(capacity * a.itemSize),
          a.itemSize,
        );
        attribute.setUsage(DynamicDrawUsage);
        geometry.setAttribute(a.name, attribute);
      }
      this.#ownGeometry = geometry;
    }
    const old = this.#mesh as InstancedMesh | undefined;
    if (old) {
      old.removeFromParent();
      old.dispose();
    }
    const mesh = new InstancedMesh(geometry, this.#material, capacity);
    mesh.name = this.#options.name;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    if (this.#options.hasColor) {
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
    }
    mesh.castShadow = this.#options.castShadow ?? false;
    mesh.receiveShadow = this.#options.receiveShadow ?? false;
    // One mesh spans the city and instances move around: culling is the draw distance's job.
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.#mesh = mesh;
    this.#parent.add(mesh);
    this.#isDirty = true;
  }
}
