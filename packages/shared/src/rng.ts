/** Returns a float in [0, 1). Same seed, same sequence, on every JS engine. */
export type Rng = () => number;

const UINT32 = 0x1_0000_0000;

/** mulberry32: 32-bit state, integer ops only, so it's bit-identical across engines. */
export function rng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

/** Float in [min, max). */
export function range(random: Rng, min: number, max: number): number {
  return min + random() * (max - min);
}

/** Integer in [min, max] inclusive. */
export function rangeInt(random: Rng, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

export function pick<T>(random: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick() needs at least one item');
  // The index is always in range, so the assertion is safe.
  return items[Math.floor(random() * items.length)] as T;
}

/** FNV-1a over UTF-16 code units → uint32. Use it to turn ids and slugs into seeds. */
export function hashString(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
