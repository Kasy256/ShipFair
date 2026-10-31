import { rng } from '@shipfair/shared';
import { describe, expect, it } from 'vitest';
import { AoiGrid } from './aoi-grid.ts';

interface Item {
  id: number;
  x: number;
  z: number;
}

const within = (grid: AoiGrid<Item>, x: number, z: number, r: number): number[] => {
  const out: number[] = [];
  grid.forEachWithin(x, z, r, (item) => out.push(item.id));
  return out.sort((a, b) => a - b);
};

describe('AoiGrid', () => {
  it('matches a linear scan for random players and radii', () => {
    const random = rng(7);
    const items: Item[] = Array.from({ length: 200 }, (_, id) => ({
      id,
      x: (random() - 0.5) * 300,
      z: (random() - 0.5) * 300,
    }));
    const grid = new AoiGrid<Item>(20);
    for (const item of items) grid.insert(item);
    for (let q = 0; q < 100; q++) {
      const x = (random() - 0.5) * 300;
      const z = (random() - 0.5) * 300;
      const r = random() * 80;
      const expected = items
        .filter((i) => (i.x - x) ** 2 + (i.z - z) ** 2 <= r * r)
        .map((i) => i.id)
        .sort((a, b) => a - b);
      expect(within(grid, x, z, r)).toEqual(expected);
    }
  });

  it('includes the edge of the radius and works across negative cells', () => {
    const grid = new AoiGrid<Item>(20);
    grid.insert({ id: 1, x: -60, z: 0 });
    grid.insert({ id: 2, x: -0.01, z: -0.01 });
    expect(within(grid, 0, 0, 60)).toEqual([1, 2]);
  });

  it('starts empty again after clear', () => {
    const grid = new AoiGrid<Item>(20);
    grid.insert({ id: 1, x: 5, z: 5 });
    grid.clear();
    expect(within(grid, 5, 5, 10)).toEqual([]);
    grid.insert({ id: 2, x: 5, z: 5 });
    expect(within(grid, 5, 5, 10)).toEqual([2]);
  });
});
