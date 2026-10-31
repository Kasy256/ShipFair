import { exports } from 'cloudflare:workers';
import type { PlayerRecord } from '@shipfair/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { NEWBIE, OWNER, resetStub, seed, table } from './test/helpers.ts';

// WebRpc methods the realtime Worker calls over its service binding (ARCHITECTURE.md §6).

const BOOTH = '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a10';
const SECRET = 'test-stats-secret';
const row = { boothId: BOOTH, day: '2026-10-31', visits: 3, uniqueVisitors: 2 };

describe('WebRpc.getPlayer', () => {
  beforeEach(resetStub);

  it('returns the profile and an unbanned flag', async () => {
    const player = await exports.WebRpc.getPlayer(OWNER);
    expect(player).toEqual({
      profile: {
        id: OWNER,
        handle: 'maker1',
        displayName: 'Maker One',
        avatarStyle: {},
        createdAt: '2026-01-01T00:00:00+00:00',
      },
      banned: false,
    });
  });

  it('reads the ban every time and can skip the profile', async () => {
    // RPC stub types can't express `unknown` (avatarStyle), so the record is typed by hand here.
    const before = (await exports.WebRpc.getPlayer(NEWBIE)) as PlayerRecord | null;
    expect(before?.banned).toBe(false);
    await seed({ bans: [{ user_id: NEWBIE, reason: 'spam', until: null }] });
    expect(await exports.WebRpc.getPlayer(NEWBIE, false)).toEqual({ profile: null, banned: true });
  });

  it('answers null for a malformed user id', async () => {
    expect(await exports.WebRpc.getPlayer('not-a-uuid')).toBeNull();
  });
});

describe('WebRpc.ingestStats', () => {
  beforeEach(resetStub);

  it('upserts a valid batch in one SQL call', async () => {
    const result = await exports.WebRpc.ingestStats({ shard: 'w-1', secret: SECRET, rows: [row] });
    expect(result).toEqual({ ok: true, written: 1 });
    expect(await table('ingested')).toEqual([[row]]);
  });

  it('refuses a wrong secret and a malformed batch without touching the database', async () => {
    expect(
      await exports.WebRpc.ingestStats({ shard: 'w-1', secret: 'guess', rows: [row] }),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await exports.WebRpc.ingestStats({
        shard: 'w-1',
        secret: SECRET,
        rows: [{ ...row, visits: -1 }],
      }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(await exports.WebRpc.ingestStats('nope')).toEqual({ ok: false, error: 'invalid' });
    expect(await table('ingested')).toEqual([]);
  });

  it('skips the database for an empty batch', async () => {
    expect(await exports.WebRpc.ingestStats({ shard: 'w-2', secret: SECRET, rows: [] })).toEqual({
      ok: true,
      written: 0,
    });
    expect(await table('ingested')).toEqual([]);
  });
});

describe('WebRpc.world', () => {
  beforeEach(async () => {
    await resetStub();
    await exports.WebRpc.purgeWorld();
  });

  it('returns the same snapshot /api/world serves', async () => {
    const world = await exports.WebRpc.world();
    expect(world?.districts.map((d) => d.slug)).toEqual(['ai-agents', 'dev-tools']);
    expect(world?.booths.map((b) => b.slug)).toEqual([
      'example-pretend-pilot',
      'example-quote-maker',
    ]);
  });
});
