import type { QualityTier } from '@shipfair/shared';
import { LOD_HYSTERESIS_M, LOD0_COUNT, LOD1_COUNT, LOD1_MAX_DISTANCE_M } from '../config.ts';

/** 0 = full glTF character, 1 = simplified glTF character, 2 = instanced procedural stand-in. */
export type LodLevel = 0 | 1 | 2;
export const STAND_IN = 2 as const;

/** Reusable buffers so assigning LODs allocates nothing. Sized for `capacity` players. */
export interface LodScratch {
  order: Uint16Array;
  effective: Float32Array;
}

export const createLodScratch = (capacity: number): LodScratch => ({
  order: new Uint16Array(capacity),
  effective: new Float32Array(capacity),
});

/** Insertion sort of `order[0..count)` by `key`, stable, so ties keep index order. */
function sortBy(order: Uint16Array, key: Float32Array, count: number): void {
  for (let i = 1; i < count; i++) {
    const item = order[i] ?? 0;
    const k = key[item] ?? 0;
    let j = i - 1;
    while (j >= 0 && (key[order[j] ?? 0] ?? 0) > k) {
      order[j + 1] = order[j] ?? 0;
      j--;
    }
    order[j + 1] = item;
  }
}

/**
 * The remote-player LOD policy (ARCHITECTURE.md §4): the nearest LOD0_COUNT get LOD0, the next
 * LOD1_COUNT within LOD1_MAX_DISTANCE_M get LOD1, the rest the stand-in. A player keeps its LOD
 * until a rival is LOD_HYSTERESIS_M closer, and keeps LOD1 until it is that far past the limit,
 * so players near a boundary don't flicker. `lods` is read (previous) and written (new).
 */
export function assignLods(
  distances: Float32Array,
  lods: Uint8Array,
  count: number,
  tier: QualityTier,
  scratch: LodScratch,
): void {
  const { order, effective } = scratch;
  const n0 = LOD0_COUNT[tier];
  const n1 = LOD1_COUNT[tier];
  for (let i = 0; i < count; i++) {
    order[i] = i;
    effective[i] = (distances[i] ?? 0) - (lods[i] === 0 ? LOD_HYSTERESIS_M : 0);
  }
  sortBy(order, effective, count);
  const lod0 = Math.min(n0, count);
  for (let r = 0; r < count; r++) {
    const i = order[r] ?? 0;
    // Mark LOD0 winners with a sentinel; the second pass ranks everyone else.
    if (r < lod0) lods[i] = 255;
  }
  let rest = 0;
  for (let i = 0; i < count; i++) {
    if (lods[i] === 255) continue;
    order[rest++] = i;
    effective[i] = (distances[i] ?? 0) - ((lods[i] ?? STAND_IN) <= 1 ? LOD_HYSTERESIS_M : 0);
  }
  sortBy(order, effective, rest);
  let given = 0;
  for (let r = 0; r < rest; r++) {
    const i = order[r] ?? 0;
    const isNear = (effective[i] ?? 0) < LOD1_MAX_DISTANCE_M;
    lods[i] = isNear && given < n1 ? 1 : STAND_IN;
    if (lods[i] === 1) given++;
  }
  for (let i = 0; i < count; i++) if (lods[i] === 255) lods[i] = 0;
}

/** How many players are at each level (for tests and the perf overlay). */
export function countLods(
  lods: Uint8Array,
  count: number,
  out: [number, number, number],
): [number, number, number] {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  for (let i = 0; i < count; i++) {
    const lod = (lods[i] ?? STAND_IN) as LodLevel;
    out[lod]++;
  }
  return out;
}
