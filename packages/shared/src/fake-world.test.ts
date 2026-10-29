import { describe, expect, it } from 'vitest';
import { fakeLateBooths, fakeWorld } from '../test/fake-world.ts';
import { BoothChange, WorldSnapshot } from './schemas/world.ts';

describe('fakeWorld', () => {
  it('produces a valid /api/world snapshot', () => {
    const world = fakeWorld(500, 7);
    expect(WorldSnapshot.safeParse(world).success).toBe(true);
    expect(world.booths).toHaveLength(500);
    expect(new Set(world.booths.map((b) => b.slug)).size).toBe(500);
  });

  it('is deterministic per seed', () => {
    expect(fakeWorld(50, 3)).toEqual(fakeWorld(50, 3));
    expect(fakeWorld(50, 3)).not.toEqual(fakeWorld(50, 4));
  });

  it('late booths are approved after the snapshot and are valid changes', () => {
    const world = fakeWorld(20, 1);
    const late = fakeLateBooths(5, 1, 20);
    const last = Math.max(...world.booths.map((b) => Date.parse(b.approvedAt)));
    for (const booth of late) {
      expect(Date.parse(booth.approvedAt)).toBeGreaterThan(last);
      expect(BoothChange.safeParse({ type: 'upsert', booth }).success).toBe(true);
    }
  });
});
