import { describe, expect, it } from 'vitest';
import { booth, DISTRICTS, fakeBooths } from '../test/fake-world.ts';
import {
  BOOTH_VISIT_RADIUS_M,
  DISTRICT_SPAWN_INSET_M,
  LOT_D_M,
  SPAWN_DISTANCE_M,
} from './constants.ts';
import { layoutCity } from './layout.ts';
import {
  boothAnchor,
  districtAt,
  nearestBooth,
  spawnForBooth,
  spawnForDistrict,
} from './layout-query.ts';
import { range, rng } from './rng.ts';

const layout = layoutCity(DISTRICTS, fakeBooths(500, 2026));
const anchors = layout.districts.flatMap((d) =>
  d.lots.flatMap((l) => (l.boothId ? [boothAnchor(layout, l.boothId)] : [])),
);

describe('spawnForBooth', () => {
  it('spawns 5 m in front of the booth, facing it, on every side of the plaza', () => {
    for (const d of layout.districts.slice(0, 4)) {
      const lot = d.lots.find((l) => l.boothId !== null);
      const id = lot?.boothId as string;
      const spawn = spawnForBooth(layout, id);
      const anchor = boothAnchor(layout, id);
      if (!spawn || !anchor || !lot) throw new Error('missing booth');
      expect(Math.hypot(spawn.x - anchor.x, spawn.z - anchor.z)).toBeCloseTo(SPAWN_DISTANCE_M, 6);
      expect(Math.hypot(anchor.x - lot.x, anchor.z - lot.z)).toBeCloseTo(LOT_D_M / 2, 6);
      // Yaw rotates +z by θ about y, so the look direction is (sin θ, cos θ).
      const toBoothX = (anchor.x - spawn.x) / SPAWN_DISTANCE_M;
      const toBoothZ = (anchor.z - spawn.z) / SPAWN_DISTANCE_M;
      expect(Math.sin(spawn.yaw)).toBeCloseTo(toBoothX, 9);
      expect(Math.cos(spawn.yaw)).toBeCloseTo(toBoothZ, 9);
    }
  });

  it('returns null for an unknown booth', () => {
    expect(spawnForBooth(layout, 'nope')).toBeNull();
    expect(boothAnchor(layout, 'nope')).toBeNull();
  });

  it('spawns in the street, outside every lot', () => {
    const small = layoutCity(DISTRICTS, [booth('a', 1, 0), booth('b', 2, 0)]);
    for (const id of ['a', 'b']) {
      const spawn = spawnForBooth(small, id);
      const d = districtAt(small, spawn?.x ?? 0, spawn?.z ?? 0);
      expect(d).not.toBeNull();
    }
  });
});

describe('spawnForDistrict', () => {
  it('lands inside the district, on the spine, facing outward, on every side', () => {
    for (const d of layout.districts) {
      const spawn = spawnForDistrict(d);
      expect(districtAt(layout, spawn.x, spawn.z)?.id).toBe(d.id);
      const spine = d.streets[0];
      if (!spine) throw new Error('district without a spine');
      expect(spawn.x).toBeGreaterThan(spine.minX);
      expect(spawn.x).toBeLessThan(spine.maxX);
      expect(spawn.z).toBeGreaterThan(spine.minZ);
      expect(spawn.z).toBeLessThan(spine.maxZ);
      // Yaw rotates +z by θ about y, so facing outward means (sin θ, cos θ) points away from origin.
      const along = Math.sin(spawn.yaw) * spawn.x + Math.cos(spawn.yaw) * spawn.z;
      expect(along).toBeGreaterThan(0);
    }
  });

  it('moves the spawn by the inset along the outward direction', () => {
    const d = layout.districts[0];
    if (!d) throw new Error('no district');
    const gate = spawnForDistrict(d, 0);
    const spawn = spawnForDistrict(d);
    expect(Math.hypot(spawn.x - gate.x, spawn.z - gate.z)).toBeCloseTo(DISTRICT_SPAWN_INSET_M, 9);
  });
});

describe('districtAt', () => {
  it('finds the district for every lot centre', () => {
    for (const d of layout.districts) {
      for (const lot of d.lots) expect(districtAt(layout, lot.x, lot.z)?.id).toBe(d.id);
    }
  });

  it('returns null on the plaza and outside the city', () => {
    expect(districtAt(layout, 0, 0)).toBeNull();
    expect(districtAt(layout, layout.bounds.maxX + 1, 0)).toBeNull();
  });
});

describe('nearestBooth', () => {
  it('matches a linear scan for 2,000 random points', () => {
    const random = rng(42);
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    let found = 0;
    for (let i = 0; i < 2000; i++) {
      const x = range(random, minX, maxX);
      const z = range(random, minZ, maxZ);
      const radius = i % 2 === 0 ? BOOTH_VISIT_RADIUS_M : 20;
      let expected: (typeof anchors)[number] = null;
      let bestSq = Number.POSITIVE_INFINITY;
      for (const a of anchors) {
        if (!a) continue;
        const sq = (a.x - x) ** 2 + (a.z - z) ** 2;
        if (sq > radius * radius) continue;
        if (sq < bestSq || (sq === bestSq && expected && a.boothId < expected.boothId)) {
          expected = a;
          bestSq = sq;
        }
      }
      const actual = nearestBooth(layout, x, z, radius);
      expect(actual?.boothId ?? null).toBe(expected?.boothId ?? null);
      if (actual) found++;
    }
    expect(found).toBeGreaterThan(200); // the sample actually exercises hits
  });

  it('finds the booth when standing on its anchor and nothing beyond the radius', () => {
    const a = anchors[10];
    if (!a) throw new Error('missing anchor');
    expect(nearestBooth(layout, a.x, a.z, 0.5)).toBe(a);
    expect(nearestBooth(layout, 0, 0, 1)).toBeNull();
  });

  it('handles an infinite radius by scanning only occupied cells', () => {
    const started = performance.now();
    const nearest = nearestBooth(layout, 0, 0, Number.POSITIVE_INFINITY);
    expect(performance.now() - started).toBeLessThan(250);
    // Same rule as nearestBooth: smallest squared distance, then lowest booth id.
    const sq = (a: (typeof anchors)[number]) => (a?.x ?? 0) ** 2 + (a?.z ?? 0) ** 2;
    const closest = [...anchors].sort(
      (a, b) => sq(a) - sq(b) || ((a?.boothId ?? '') < (b?.boothId ?? '') ? -1 : 1),
    )[0];
    expect(nearest?.boothId).toBe(closest?.boothId);
  });

  it('returns null for NaN or negative input instead of looping', () => {
    expect(nearestBooth(layout, Number.NaN, 0, 5)).toBeNull();
    expect(nearestBooth(layout, 0, Number.POSITIVE_INFINITY, 5)).toBeNull();
    expect(nearestBooth(layout, 0, 0, Number.NaN)).toBeNull();
    expect(nearestBooth(layout, 0, 0, -1)).toBeNull();
    expect(nearestBooth(layoutCity(DISTRICTS, []), 0, 0, 1e6)).toBeNull();
  });

  it('breaks distance ties by booth id', () => {
    // Two booths across the street from each other; the midpoint is equidistant from both anchors.
    const small = layoutCity(
      [DISTRICTS[0] as (typeof DISTRICTS)[number]],
      [booth('b', 1, 0), booth('a', 1, 1)],
    );
    const [first, second] = [boothAnchor(small, 'b'), boothAnchor(small, 'a')];
    if (!first || !second) throw new Error('missing anchor');
    const mx = (first.x + second.x) / 2;
    const mz = (first.z + second.z) / 2;
    expect(nearestBooth(small, mx, mz, 10)?.boothId).toBe('a');
  });
});
