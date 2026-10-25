import { describe, expect, it } from 'vitest';
import { hashString, pick, range, rangeInt, rng } from './rng.ts';

describe('rng', () => {
  it('is reproducible for a seed and differs between seeds', () => {
    const a = rng(123);
    const b = rng(123);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, rng(124))).not.toEqual(seqA);
  });

  it('matches the reference mulberry32 implementation', () => {
    // bryc's original (github.com/bryc/code, PRNGs.md), kept verbatim apart from formatting.
    const reference = (seed: number) => () => {
      seed += 0x6d2b79f5;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (const seed of [0, 1, 2026, 0xffffffff]) {
      const ours = rng(seed);
      const theirs = reference(seed);
      for (let i = 0; i < 1000; i++) expect(ours()).toBe(theirs());
    }
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const random = rng(9);
    const buckets = new Array<number>(10).fill(0);
    let outOfRange = 0;
    for (let i = 0; i < 100_000; i++) {
      const v = random();
      if (!(v >= 0 && v < 1)) outOfRange++;
      const bucket = Math.floor(v * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    expect(outOfRange).toBe(0);
    for (const n of buckets) expect(Math.abs(n - 10_000)).toBeLessThan(500);
  });

  it('range, rangeInt and pick stay in bounds', () => {
    const random = rng(5);
    for (let i = 0; i < 1000; i++) {
      const f = range(random, -2, 3);
      expect(f >= -2 && f < 3).toBe(true);
      const n = rangeInt(random, 1, 6);
      expect(Number.isInteger(n) && n >= 1 && n <= 6).toBe(true);
      expect(['a', 'b', 'c']).toContain(pick(random, ['a', 'b', 'c']));
    }
    expect(() => pick(random, [])).toThrow(RangeError);
  });
});

describe('hashString', () => {
  it('returns FNV-1a uint32 values', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });

  it('spreads similar strings apart', () => {
    expect(hashString('booth-1')).not.toBe(hashString('booth-2'));
  });
});
