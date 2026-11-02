import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR_STYLE } from './avatar.ts';
import {
  boothMilestones,
  isUnlockMet,
  lockedItems,
  MergeRequest,
  PassportEvidence,
  StampKey,
  StampRequest,
  stampCategory,
  withoutLockedItems,
  wornLockedItems,
} from './passport.ts';
import { StatsBatch } from './realtime.ts';

const USER = '00000000-0000-4000-8000-000000000001';
const BOOTH = '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a10';

describe('StampKey', () => {
  it('accepts every stamp the app awards', () => {
    for (const key of [
      'district:ai-agents',
      'booths:1',
      'booths:10',
      'booths:50',
      'booths:100',
      'first:upvote',
      'first:note',
      'first:chat',
      'met-a-maker',
      'squad',
    ]) {
      expect(StampKey.safeParse(key).success, key).toBe(true);
    }
  });

  it('refuses unknown milestones, kinds and malformed slugs', () => {
    for (const key of ['booths:2', 'booths:1000', 'district:AI', 'district:x', 'first:vote', '']) {
      expect(StampKey.safeParse(key).success, key).toBe(false);
    }
  });
});

describe('requests', () => {
  it('caps stamp and merge batches', () => {
    expect(StampRequest.safeParse({ stamps: [] }).success).toBe(false);
    expect(StampRequest.safeParse({ stamps: Array(9).fill('squad') }).success).toBe(false);
    expect(MergeRequest.safeParse({ guestId: USER, stamps: Array(65).fill('squad') }).success).toBe(
      false,
    );
    expect(MergeRequest.safeParse({ guestId: 'nope', stamps: [] }).success).toBe(false);
    expect(MergeRequest.safeParse({ guestId: USER, stamps: ['district:dev-tools'] }).success).toBe(
      true,
    );
  });
});

describe('helpers', () => {
  it('sorts stamps into book pages', () => {
    expect(stampCategory('district:weird')).toBe('districts');
    expect(stampCategory('booths:10')).toBe('booths');
    expect(stampCategory('met-a-maker')).toBe('social');
  });

  it('lists the milestones a visit count reaches', () => {
    expect(boothMilestones(0)).toEqual([]);
    expect(boothMilestones(10)).toEqual(['booths:1', 'booths:10']);
    expect(boothMilestones(120)).toEqual(['booths:1', 'booths:10', 'booths:50', 'booths:100']);
  });

  it('evaluates unlock rules', () => {
    const slugs = ['ai-agents', 'dev-tools'];
    const one = new Set(['district:ai-agents']);
    const both = new Set(['district:ai-agents', 'district:dev-tools', 'booths:50']);
    expect(isUnlockMet('stamp:district:all', one, slugs)).toBe(false);
    expect(isUnlockMet('stamp:district:all', both, slugs)).toBe(true);
    expect(isUnlockMet('stamp:district:all', both, [])).toBe(false);
    expect(isUnlockMet('stamp:booths:50', both, slugs)).toBe(true);
    expect(isUnlockMet('stamp:booths:50', one, slugs)).toBe(false);
    expect(isUnlockMet('level:9', both, slugs)).toBe(false);
  });

  it('finds locked catalog items', () => {
    expect(lockedItems(['backpack', 'lanyard', 'tshirt'], new Set(), ['ai-agents'])).toEqual([
      'backpack',
      'lanyard',
    ]);
    expect(lockedItems(['lanyard'], new Set(['booths:50']), ['ai-agents'])).toEqual([]);
  });

  it('takes locked items off a look unless they are allowed', () => {
    const look = {
      ...DEFAULT_AVATAR_STYLE,
      accessory: { item: 'backpack' as const, color: 4 },
    };
    expect(wornLockedItems(DEFAULT_AVATAR_STYLE)).toEqual([]);
    expect(wornLockedItems(look)).toEqual(['backpack']);
    expect(withoutLockedItems(look, new Set())).toEqual({
      ...look,
      accessory: { item: 'none', color: 4 },
    });
    expect(withoutLockedItems(look, new Set(['backpack']))).toBe(look);
  });
});

describe('evidence', () => {
  it('checks each kind of key', () => {
    const ok = [
      { player: USER, kind: 'district', key: 'dev-tools' },
      { player: `guest:${USER}`, kind: 'booth', key: BOOTH },
      { player: USER, kind: 'fact', key: 'met-a-maker' },
    ];
    for (const row of ok) expect(PassportEvidence.safeParse(row).success).toBe(true);
    const bad = [
      { player: 'guest:nope', kind: 'district', key: 'dev-tools' },
      { player: USER, kind: 'booth', key: 'dev-tools' },
      { player: USER, kind: 'fact', key: 'first:upvote' },
    ];
    for (const row of bad) expect(PassportEvidence.safeParse(row).success).toBe(false);
  });

  it('is optional in a stats batch', () => {
    const batch = StatsBatch.parse({ shard: 'w-1', secret: 's', rows: [] });
    expect(batch.evidence).toEqual([]);
  });
});
