import type { CityLayout } from '@shipfair/shared';
import { fakeLateBooths, fakeWorld } from '@shipfair/shared/fake-world';
import { describe, expect, it } from 'vitest';
import { CityModel } from './city-model.ts';

/** booth id → "x,z,facing,span" for every placed booth. */
function placements(layout: CityLayout): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of layout.districts) {
    for (const lot of d.lots) {
      if (lot.boothId) out.set(lot.boothId, `${lot.x},${lot.z},${lot.facing},${lot.span}`);
    }
  }
  return out;
}

describe('CityModel', () => {
  it('lays out the snapshot deterministically', () => {
    const a = new CityModel(fakeWorld(200, 9));
    const b = new CityModel(fakeWorld(200, 9));
    expect(placements(a.layout)).toEqual(placements(b.layout));
    expect(a.liveCount).toBe(200);
  });

  it('adds booths without moving any existing booth', () => {
    const model = new CityModel(fakeWorld(500, 1));
    const before = placements(model.layout);
    const late = fakeLateBooths(20, 1, 500);
    const diff = model.apply(late.map((booth) => ({ type: 'upsert', booth })));
    expect(diff.added).toHaveLength(20);
    const after = placements(model.layout);
    for (const [id, where] of before) expect(after.get(id)).toBe(where);
    expect(after.size).toBe(520);
  });

  it('orders a late booth with an old timestamp after everything else', () => {
    const world = fakeWorld(60, 2);
    const model = new CityModel(world);
    const before = placements(model.layout);
    const [late] = fakeLateBooths(1, 2, 60);
    if (!late) throw new Error('no booth');
    // Approved "before" every booth in the snapshot, e.g. re-approved after moderation.
    model.apply([{ type: 'upsert', booth: { ...late, approvedAt: '2020-01-01T00:00:00.000Z' } }]);
    const after = placements(model.layout);
    for (const [id, where] of before) expect(after.get(id)).toBe(where);
  });

  it('keeps a removed booth lot empty so later booths stay put', () => {
    const world = fakeWorld(100, 3);
    const model = new CityModel(world);
    const before = placements(model.layout);
    const gone = world.booths[10]?.id ?? '';
    const diff = model.apply([{ type: 'remove', boothId: gone }]);
    expect(diff.removed).toEqual([gone]);
    expect(model.isLive(gone)).toBe(false);
    const after = placements(model.layout);
    for (const [id, where] of before) expect(after.get(id)).toBe(where);
    // A new booth doesn't take the tombstoned lot either.
    const [late] = fakeLateBooths(1, 3, 100);
    if (!late) throw new Error('no booth');
    model.apply([{ type: 'upsert', booth: late }]);
    expect(placements(model.layout).get(late.id)).not.toBe(before.get(gone));
  });

  it('updates a booth in place and pins a footprint-changing tier', () => {
    const world = fakeWorld(80, 4);
    const model = new CityModel(world);
    const stall = world.booths.find((b) => b.tier === 'stall');
    if (!stall) throw new Error('no stall');
    const before = placements(model.layout);
    const upgrade = model.apply([{ type: 'upsert', booth: { ...stall, tier: 'booth' } }]);
    expect(upgrade.updated).toEqual([stall.id]);
    expect(model.tierOf(stall.id)).toBe('booth');
    model.apply([{ type: 'upsert', booth: { ...stall, tier: 'pavilion', name: 'Renamed' } }]);
    expect(model.tierOf(stall.id)).toBe('booth');
    expect(model.booth(stall.id)?.name).toBe('Renamed');
    expect(placements(model.layout)).toEqual(before);
  });

  it('finds booths by slug and lists the newest', () => {
    const world = fakeWorld(30, 5);
    const model = new CityModel(world);
    const last = world.booths[29];
    expect(model.bySlug(last?.slug ?? '')?.id).toBe(last?.id);
    expect(model.latest(1)[0]?.id).toBe(last?.id);
  });

  it('reports when a district grows a street', () => {
    const model = new CityModel(fakeWorld(0, 6));
    const late = fakeLateBooths(40, 6, 0);
    expect(model.apply(late.map((booth) => ({ type: 'upsert', booth }))).hasNewStreets).toBe(true);
  });
});
