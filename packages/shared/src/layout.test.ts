import { describe, expect, it } from 'vitest';
import { booth, DISTRICTS, fakeBooths } from '../test/fake-world.ts';
import { LOT_D_M, LOT_W_M, LOTS_PER_STREET_SIDE } from './constants.ts';
import { type CityLayout, type LayoutBooth, type Lot, layoutCity, type Rect } from './layout.ts';
import { hashString, rng } from './rng.ts';

const LOTS_PER_STREET = 2 * LOTS_PER_STREET_SIDE;
const ONE = [DISTRICTS[0] as (typeof DISTRICTS)[number]];

/** World-space footprint of a lot: frontage along the street, depth away from it. */
function footprint(lot: Lot): Rect {
  const along = (lot.span * LOT_W_M) / 2;
  const across = LOT_D_M / 2;
  const [hx, hz] = lot.facing % 2 === 0 ? [along, across] : [across, along];
  return { minX: lot.x - hx, minZ: lot.z - hz, maxX: lot.x + hx, maxZ: lot.z + hz };
}

// Strict overlap: rects that only touch along an edge don't count.
const overlaps = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

const inside = (inner: Rect, outer: Rect): boolean =>
  inner.minX >= outer.minX &&
  inner.minZ >= outer.minZ &&
  inner.maxX <= outer.maxX &&
  inner.maxZ <= outer.maxZ;

const hashLayout = (layout: CityLayout): number => hashString(JSON.stringify(layout));

function allNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) for (const v of value) allNumbers(v, out);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) allNumbers(v, out);
  return out;
}

describe('layoutCity', () => {
  it('lays out the plaza alone when there are no districts', () => {
    const layout = layoutCity([], []);
    expect(layout.districts).toEqual([]);
    expect(layout.bounds).toEqual(layout.plaza.rect);
    expect(layout.plaza.spawn).toEqual({ x: 0, z: 0, yaw: 0 });
  });

  it('gives each district one empty street with 0 booths', () => {
    const layout = layoutCity(DISTRICTS, []);
    expect(layout.districts).toHaveLength(8);
    for (const d of layout.districts) {
      expect(d.streetCount).toBe(1);
      expect(d.streets).toHaveLength(2); // spine + 1 cross street
      expect(d.lots).toHaveLength(LOTS_PER_STREET);
      expect(d.lots.every((l) => l.boothId === null && l.tier === null)).toBe(true);
      expect(overlaps(d.rect, layout.plaza.rect)).toBe(false);
    }
    // One district per plaza side for the first four, in sortOrder.
    expect(layout.districts.slice(0, 4).map((d) => d.outward)).toEqual([0, 1, 2, 3]);
  });

  it('puts 1 booth in the first lot of its district, facing the street', () => {
    const layout = layoutCity(DISTRICTS, [booth('b-1', 3, 0)]);
    const d = layout.districts.find((x) => x.id === 3);
    expect(d?.lots[0]).toMatchObject({
      boothId: 'b-1',
      tier: 'stall',
      span: 1,
      facing: d?.outward,
    });
    expect(layout.districts.flatMap((x) => x.lots).filter((l) => l.boothId)).toHaveLength(1);
  });

  it('fills lots by approvedAt, then id, whatever the input order', () => {
    const booths = [booth('c', 1, 5), booth('b', 1, 1), booth('a', 1, 1)];
    const layout = layoutCity(ONE, booths);
    expect(layout.districts[0]?.lots.slice(0, 3).map((l) => l.boothId)).toEqual(['a', 'b', 'c']);
    expect(layoutCity(ONE, [...booths].reverse())).toEqual(layout);
  });

  it('adds a street once a district is 80% full', () => {
    const streetsFor = (n: number) =>
      layoutCity(
        ONE,
        Array.from({ length: n }, (_, i) => booth(`b-${String(i).padStart(3, '0')}`, 1, i)),
      ).districts[0]?.streetCount;
    // 12 lots per street: 9/12 = 75% stays, 10/12 = 83% grows. 19/24 = 79% stays, 20/24 grows.
    expect(streetsFor(9)).toBe(1);
    expect(streetsFor(10)).toBe(2);
    expect(streetsFor(19)).toBe(2);
    expect(streetsFor(20)).toBe(3);
  });

  it('gives a pavilion 2 adjacent lots on the same side of one street', () => {
    const layout = layoutCity(ONE, [booth('p', 1, 0, 'pavilion'), booth('s', 1, 1)]);
    const lots = layout.districts[0]?.lots ?? [];
    const pavilion = lots.find((l) => l.boothId === 'p');
    expect(pavilion).toMatchObject({ span: 2, tier: 'pavilion' });
    // 12 physical lots: one double plus 10 singles.
    expect(lots).toHaveLength(11);
    expect(lots.reduce((sum, l) => sum + l.span, 0)).toBe(LOTS_PER_STREET);
    const fp = footprint(pavilion as Lot);
    expect(Math.max(fp.maxX - fp.minX, fp.maxZ - fp.minZ)).toBe(2 * LOT_W_M);
    // The stall takes the first free lot: the one across the street from the pavilion's start.
    expect(lots[1]).toMatchObject({ boothId: 's', span: 1 });
  });

  it('never splits a pavilion across the end of a row', () => {
    // Five stalls per side fill along-positions 0–4 on both sides; slot 5 is a single lot only.
    const stalls = Array.from({ length: 10 }, (_, i) =>
      booth(`s-${String(i).padStart(2, '0')}`, 1, i),
    );
    const layout = layoutCity(ONE, [...stalls, booth('p', 1, 99, 'pavilion')]);
    const d = layout.districts[0];
    const pavilion = d?.lots.find((l) => l.boothId === 'p');
    expect(pavilion?.span).toBe(2);
    expect(d?.streetCount).toBe(2);
    // It landed on the second street. District 1 grows along +z, so it's beyond every stall.
    const stallLots = d?.lots.filter((l) => l.tier === 'stall') ?? [];
    expect(stallLots.every((l) => l.z < (pavilion as Lot).z)).toBe(true);
  });

  it('skips booths whose district is missing, and duplicate ids', () => {
    const layout = layoutCity(ONE, [booth('x', 99, 0), booth('a', 1, 1), booth('a', 1, 2)]);
    expect(layout.unplaced).toEqual(['x']);
    expect(layout.districts[0]?.lots.filter((l) => l.boothId === 'a')).toHaveLength(1);
  });

  describe('500 booths across 8 districts', () => {
    const booths = fakeBooths(500, 2026);
    const layout = layoutCity(DISTRICTS, booths);
    const lots = layout.districts.flatMap((d) => d.lots);

    it('places every booth exactly once', () => {
      const placed = lots.flatMap((l) => (l.boothId ? [l.boothId] : []));
      expect(placed).toHaveLength(500);
      expect(new Set(placed).size).toBe(500);
      expect(layout.unplaced).toEqual([]);
      expect(lots.filter((l) => l.tier === 'pavilion').every((l) => l.span === 2)).toBe(true);
    });

    it('has no overlapping lots, streets or districts', () => {
      const countOverlaps = (a: Rect[], b: Rect[] = a): number => {
        let n = 0;
        for (let i = 0; i < a.length; i++) {
          for (let j = a === b ? i + 1 : 0; j < b.length; j++) {
            if (overlaps(a[i] as Rect, b[j] as Rect)) n++;
          }
        }
        return n;
      };
      const lotRects = lots.map(footprint);
      const streets = layout.districts.flatMap((d) => d.streets);
      expect(countOverlaps(lotRects)).toBe(0);
      expect(countOverlaps(lotRects, streets)).toBe(0);
      expect(countOverlaps([layout.plaza.rect, ...layout.districts.map((d) => d.rect)])).toBe(0);
    });

    it('keeps every lot and street inside its district and the city bounds', () => {
      for (const d of layout.districts) {
        expect(inside(d.rect, layout.bounds)).toBe(true);
        for (const lot of d.lots) expect(inside(footprint(lot), d.rect)).toBe(true);
        for (const s of d.streets) expect(inside(s, d.rect)).toBe(true);
      }
    });

    it('keeps every district under 80% full after growing', () => {
      for (const d of layout.districts) {
        const used = d.lots.reduce((n, l) => n + (l.boothId ? l.span : 0), 0);
        expect(used / (d.streetCount * LOTS_PER_STREET)).toBeLessThan(0.8);
        expect(d.streetCount).toBeGreaterThan(1);
      }
    });

    it('outputs whole centimetres and quarter-turn facings only', () => {
      for (const n of allNumbers(layout)) expect(Math.round(n * 100) / 100).toBe(n);
      expect(lots.every((l) => [0, 1, 2, 3].includes(l.facing))).toBe(true);
    });

    it('is deterministic across runs and input order', () => {
      const hashes = [1, 2, 3].map(() => hashLayout(layoutCity(DISTRICTS, booths)));
      const random = rng(7);
      const shuffled = [...booths];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j] as LayoutBooth, shuffled[i] as LayoutBooth];
      }
      expect(shuffled).not.toEqual(booths);
      hashes.push(hashLayout(layoutCity([...DISTRICTS].reverse(), shuffled)));
      expect(new Set(hashes).size).toBe(1);
      // Snapshot of the fixed seed dataset: changes here mean every client's city moves.
      expect(hashes[0]).toMatchInlineSnapshot(`1505988621`);
      expect(layout.bounds).toMatchInlineSnapshot(`
        {
          "maxX": 237,
          "maxZ": 237,
          "minX": -215,
          "minZ": -193,
        }
      `);
    });
  });
});
