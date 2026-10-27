import { LOT_D_M, layoutCity } from '@shipfair/shared';
import { describe, expect, it } from 'vitest';
import { PROP_SETS, planDistrictProps, STREET_LAMP } from './prop-plan.ts';

const districts = [
  { id: 1, slug: 'dev-tools', theme: 'dev-tools', sortOrder: 0 },
  { id: 2, slug: 'odd', theme: 'no-such-theme', sortOrder: 1 },
];
const booths = Array.from({ length: 30 }, (_, i) => ({
  id: `b${String(i).padStart(3, '0')}`,
  districtId: (i % 2) + 1,
  approvedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  tier: i % 7 === 0 ? ('pavilion' as const) : ('stall' as const),
}));
const all = new Set(Object.values(PROP_SETS).flat().concat(STREET_LAMP));

describe('planDistrictProps', () => {
  const city = layoutCity(districts, booths);
  const [devTools, odd] = city.districts;

  it('is identical for the same layout', () => {
    if (!devTools) throw new Error('no district');
    expect(planDistrictProps(devTools, all)).toEqual(
      planDistrictProps(layoutCity(districts, booths).districts[0] ?? devTools, all),
    );
  });

  it('puts a lamp on every other lot, in the street in front of the lot', () => {
    if (!devTools) throw new Error('no district');
    const props = planDistrictProps(devTools, all);
    const lamps = props.filter((p) => p.id === STREET_LAMP);
    expect(lamps).toHaveLength(Math.ceil(devTools.lots.length / 2));
    const lot = devTools.lots[0];
    const lamp = lamps[0];
    if (!lot || !lamp) throw new Error('missing');
    // The lamp sits beyond the lot's front edge along its facing direction.
    const ahead = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ][lot.facing] ?? [0, 1];
    const along = (lamp.x - lot.x) * (ahead[0] ?? 0) + (lamp.z - lot.z) * (ahead[1] ?? 0);
    expect(along).toBeGreaterThan(LOT_D_M / 2);
  });

  it('uses the theme set, falls back to default, and skips unavailable ids', () => {
    if (!devTools || !odd) throw new Error('no district');
    const themed = new Set(planDistrictProps(devTools, all).map((p) => p.id));
    for (const id of themed) expect([...(PROP_SETS['dev-tools'] ?? []), STREET_LAMP]).toContain(id);
    const fallback = new Set(planDistrictProps(odd, all).map((p) => p.id));
    for (const id of fallback) expect([...(PROP_SETS.default ?? []), STREET_LAMP]).toContain(id);
    expect(planDistrictProps(devTools, new Set())).toEqual([]);
  });

  it('rounds positions to whole centimetres', () => {
    if (!devTools) throw new Error('no district');
    for (const p of planDistrictProps(devTools, all)) {
      expect(Math.round(p.x * 100) / 100).toBe(p.x);
      expect(Math.round(p.z * 100) / 100).toBe(p.z);
    }
  });
});
