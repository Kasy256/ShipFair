import type RAPIER from '@dimforge/rapier3d-compat';
import type { BoothTier, Lot } from '@shipfair/shared';
import { Box3, type BufferGeometry, Color, Group, Matrix4, Vector3 } from 'three';
import { BUILD_UP_GLOW, BUILD_UP_S } from '../config.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import { InstanceBatch } from '../render/instance-batch.ts';
import type { BoothKit, KitPrimitive } from './kit.ts';

/** A booth as the shells see it: where (its lot), what (tier) and how it's tinted. */
export interface ShellBooth {
  readonly id: string;
  readonly tier: BoothTier;
  readonly lot: Lot;
  readonly accent: Color;
  readonly glow: Color;
  /** Theme kit variant (`<part>_<variant>` parts), or null. */
  readonly kitVariant: string | null;
}

/** Parts that block the player (by base name; theme variants match too). Rings and roofs don't. */
const SOLID_PARTS = ['kit_floor', 'kit_counter', 'kit_wall_back', 'kit_wall_side', 'kit_stage'];
const isSolid = (part: string) => SOLID_PARTS.some((p) => part === p || part.startsWith(`${p}_`));
// Quarter-turn rotation tables (no trig: identical transforms on every client).
const COS = [1, 0, -1, 0] as const;
const SIN = [0, 1, 0, -1] as const;

interface Entry {
  readonly booth: ShellBooth;
  readonly lotMatrix: Matrix4;
  readonly prims: readonly KitPrimitive[];
  /** Instance key per primitive (precomputed so animation frames don't build strings). */
  readonly keys: readonly string[];
  readonly batches: readonly InstanceBatch[];
  readonly colliders: RAPIER.Collider[];
  /** Seconds into the build-up animation; negative when not animating. */
  age: number;
  /** Uniform scale applied by the build-up (1 when idle). */
  scale: number;
}

/** The lot's world transform: centre on the ground, front (+Z) turned to its facing. */
export function lotMatrix(lot: Lot, out: Matrix4): Matrix4 {
  const c = COS[lot.facing];
  const s = SIN[lot.facing];
  // biome-ignore format: a rotation about +Y plus translation, row by row
  return out.set(
    c, 0, s, lot.x,
    0, 1, 0, 0,
    -s, 0, c, lot.z,
    0, 0, 0, 1,
  );
}

/** Ease out with a small overshoot, so a new booth pops into place. */
function easeOutBack(t: number): number {
  const k = 1.70158;
  const u = t - 1;
  return 1 + (k + 1) * u * u * u + k * u * u;
}

const scratch = new Matrix4();
const scaleM = new Matrix4();
const placement = new Matrix4();
const tint = new Color();
const box = new Box3();
const part = new Box3();
const centre = new Vector3();
const half = new Vector3();
const bounds = new WeakMap<BufferGeometry, Box3>();

function boundsOf(geometry: BufferGeometry): Box3 {
  let b = bounds.get(geometry);
  if (!b) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    b = geometry.boundingBox?.clone() ?? new Box3();
    bounds.set(geometry, b);
  }
  return b;
}

/**
 * Booth shells (ARCHITECTURE.md §4): one InstancedMesh per kit primitive per tier (and per theme
 * variant in use), tinted per instance (ACCENT by booth, GLOW by district). No per-booth meshes.
 * Booths are added and removed at runtime; new ones scale and glow in over BUILD_UP_S.
 */
export class BoothShells {
  readonly root = new Group();
  readonly #kit: BoothKit;
  readonly #physics: PhysicsWorld;
  readonly #capacity: number;
  readonly #batches = new Map<string, InstanceBatch>();
  readonly #entries = new Map<string, Entry>();
  readonly #animating: Entry[] = [];

  /** `capacity` sizes each batch up front (it still doubles when full). */
  constructor(kit: BoothKit, physics: PhysicsWorld, capacity: number) {
    this.root.name = 'booth-shells';
    this.#kit = kit;
    this.#physics = physics;
    this.#capacity = capacity;
  }

  get count(): number {
    return this.#entries.size;
  }

  get batchCount(): number {
    return this.#batches.size;
  }

  get isAnimating(): boolean {
    return this.#animating.length > 0;
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  tierOf(id: string): BoothTier | undefined {
    return this.#entries.get(id)?.booth.tier;
  }

  add(booth: ShellBooth, isAnimated: boolean): void {
    this.remove(booth.id);
    const prims = this.#kit.resolve(`tier_${booth.tier}`, booth.kitVariant);
    const entry: Entry = {
      booth,
      lotMatrix: lotMatrix(booth.lot, new Matrix4()),
      prims,
      keys: prims.map((p) => `${booth.id}#${p.placement}`),
      batches: prims.map((p) => this.#batch(p)),
      colliders: [],
      age: isAnimated ? 0 : -1,
      scale: isAnimated ? 0 : 1,
    };
    this.#entries.set(booth.id, entry);
    this.#write(entry, isAnimated ? 1 : 0);
    this.#addColliders(entry);
    if (isAnimated) this.#animating.push(entry);
  }

  remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#entries.delete(id);
    entry.batches.forEach((batch, i) => {
      batch.remove(entry.keys[i] ?? '');
    });
    if (this.#physics.isAlive) {
      for (const c of entry.colliders) this.#physics.world.removeCollider(c, false);
    }
    const index = this.#animating.indexOf(entry);
    if (index >= 0) this.#animating.splice(index, 1);
  }

  /** Where a booth is drawn: its lot transform times the build-up scale. False if unknown. */
  boothMatrix(id: string, out: Matrix4): boolean {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    out.copy(entry.lotMatrix).multiply(scaleM.makeScale(entry.scale, entry.scale, entry.scale));
    return true;
  }

  /** A `SLOT_*` transform in the booth's local space (from the kit manifest), or false. */
  slotLocal(tier: BoothTier, slot: string, out: Matrix4): boolean {
    const found = this.#kit.tiers.get(`tier_${tier}`)?.slots.find((s) => s.name === slot);
    if (!found) return false;
    out.fromArray(found.matrix);
    return true;
  }

  /** Advances build-up animations. Allocation-free. */
  update(dt: number): void {
    for (let i = this.#animating.length - 1; i >= 0; i--) {
      const entry = this.#animating[i];
      if (!entry) continue;
      entry.age += dt;
      const t = Math.min(entry.age / BUILD_UP_S, 1);
      entry.scale = Math.max(easeOutBack(t), 1e-3);
      this.#write(entry, 1 - t);
      if (t >= 1) {
        entry.age = -1;
        entry.scale = 1;
        // Swap-remove: no array allocation per finished animation.
        this.#animating[i] = this.#animating[this.#animating.length - 1] as Entry;
        this.#animating.length--;
      }
    }
    for (const batch of this.#batches.values()) batch.flush();
  }

  cull(x: number, z: number, radius: number): void {
    for (const batch of this.#batches.values()) batch.cull(x, z, radius);
  }

  /** Instances drawn after the last pack, over all batches. */
  get drawn(): number {
    let n = 0;
    for (const batch of this.#batches.values()) n += batch.drawn;
    return n;
  }

  dispose(): void {
    for (const id of [...this.#entries.keys()]) this.remove(id);
    for (const batch of this.#batches.values()) batch.dispose();
    this.#batches.clear();
    this.root.removeFromParent();
  }

  /** Writes every instance of `entry`; `glow` in [0, 1] brightens tints for the build-up. */
  #write(entry: Entry, glow: number): void {
    const { booth } = entry;
    const s = entry.scale;
    const boost = 1 + (BUILD_UP_GLOW - 1) * glow;
    // A plain loop: a forEach callback would allocate a closure every animation frame.
    for (let i = 0; i < entry.prims.length; i++) {
      const prim = entry.prims[i];
      const batch = entry.batches[i];
      const key = entry.keys[i];
      if (!prim || !batch || key === undefined) continue;
      placement.fromArray(prim.matrix);
      scratch
        .copy(entry.lotMatrix)
        .multiply(scaleM.makeScale(s, s, s))
        .multiply(placement);
      const base = prim.role === 'accent' ? booth.accent : prim.role === 'glow' ? booth.glow : null;
      const color = base ? tint.copy(base).multiplyScalar(boost) : undefined;
      if (!batch.has(key)) {
        batch.set(key, scratch, booth.lot.x, booth.lot.z, color);
        continue;
      }
      batch.setMatrix(key, scratch);
      if (color) batch.setColor(key, color);
    }
  }

  #addColliders(entry: Entry): void {
    // One box per solid placement: the union of its primitives' bounds on the lot.
    let current = -1;
    const flush = () => {
      if (current < 0 || box.isEmpty()) return;
      box.getCenter(centre);
      box.getSize(half).multiplyScalar(0.5);
      entry.colliders.push(this.#physics.addBox(centre, half));
    };
    for (const prim of entry.prims) {
      if (!isSolid(prim.part)) continue;
      if (prim.placement !== current) {
        flush();
        box.makeEmpty();
        current = prim.placement;
      }
      placement.fromArray(prim.matrix);
      scratch.copy(entry.lotMatrix).multiply(placement);
      box.union(part.copy(boundsOf(prim.geometry)).applyMatrix4(scratch));
    }
    flush();
  }

  #batch(prim: KitPrimitive): InstanceBatch {
    let batch = this.#batches.get(prim.batch);
    if (!batch) {
      batch = new InstanceBatch(this.root, prim.geometry, prim.material, {
        name: `${prim.batch}/${prim.role}`,
        hasColor: prim.role !== 'palette',
        capacity: this.#capacity,
        castShadow: prim.role !== 'glow',
        receiveShadow: true,
      });
      this.#batches.set(prim.batch, batch);
    }
    return batch;
  }
}
