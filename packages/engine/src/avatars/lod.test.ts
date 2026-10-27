import { describe, expect, it } from 'vitest';
import { LOD_HYSTERESIS_M, LOD1_MAX_DISTANCE_M } from '../config.ts';
import { assignLods, countLods, createLodScratch, STAND_IN } from './lod.ts';

const scratch = createLodScratch(64);
const fresh = (n: number) => new Uint8Array(n).fill(STAND_IN);

function run(distances: number[], tier: 'high' | 'low', lods = fresh(distances.length)) {
  assignLods(Float32Array.from(distances), lods, distances.length, tier, scratch);
  return lods;
}

describe('LOD policy', () => {
  it('gives LOD0 to the nearest 6, LOD1 to the next 12 within 25 m, stand-ins to the rest (high)', () => {
    const distances = Array.from({ length: 40 }, (_, i) => 1 + i); // 1 m … 40 m
    const lods = run(distances, 'high');
    expect(countLods(lods, 40, [0, 0, 0])).toEqual([6, 12, 22]);
    expect(Array.from(lods.slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(lods[6]).toBe(1);
    expect(lods[17]).toBe(1);
    expect(lods[18]).toBe(STAND_IN);
  });

  it('halves both caps on the low tier', () => {
    const lods = run(
      Array.from({ length: 40 }, (_, i) => 1 + i * 0.5),
      'low',
    );
    expect(countLods(lods, 40, [0, 0, 0])).toEqual([3, 6, 31]);
  });

  it('never gives LOD1 beyond 25 m, however few players there are', () => {
    const lods = run([5, 10, 20, 24, 26, 30, 40, 50, 60], 'high');
    expect(Array.from(lods)).toEqual([0, 0, 0, 0, 0, 0, STAND_IN, STAND_IN, STAND_IN]);
    const far = run([1, 2, 3, 4, 5, 6, 24.9, 25.1, 30], 'high');
    expect(Array.from(far.slice(6))).toEqual([1, STAND_IN, STAND_IN]);
  });

  it('keeps LOD1 until 2 m past the limit, and promotes only inside it', () => {
    const near = [1, 2, 3, 4, 5, 6];
    let lods = run([...near, 24], 'high');
    expect(lods[6]).toBe(1);
    lods = run([...near, LOD1_MAX_DISTANCE_M + LOD_HYSTERESIS_M - 0.1], 'high', lods);
    expect(lods[6]).toBe(1);
    lods = run([...near, LOD1_MAX_DISTANCE_M + LOD_HYSTERESIS_M + 0.1], 'high', lods);
    expect(lods[6]).toBe(STAND_IN);
    lods = run([...near, LOD1_MAX_DISTANCE_M + 1], 'high', lods);
    expect(lods[6]).toBe(STAND_IN);
  });

  it('a LOD0 player keeps its slot until a rival is more than 2 m closer', () => {
    // Low tier: 3 LOD0 slots. Player 3 starts just outside them.
    let lods = run([1, 2, 10, 11], 'low');
    expect(Array.from(lods)).toEqual([0, 0, 0, 1]);
    lods = run([1, 2, 10, 8.5], 'low', lods); // 1.5 m closer: no swap
    expect(Array.from(lods)).toEqual([0, 0, 0, 1]);
    lods = run([1, 2, 10, 7.5], 'low', lods); // 2.5 m closer: swap
    expect(Array.from(lods)).toEqual([0, 0, 1, 0]);
  });

  it('is deterministic for equal distances (lower index wins)', () => {
    const lods = run([5, 5, 5, 5], 'low');
    expect(Array.from(lods)).toEqual([0, 0, 0, 1]);
  });
});
