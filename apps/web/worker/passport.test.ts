import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from './env.ts';
import worker from './index.ts';
import { runNightly } from './passport.ts';
import { api, errorCode, OWNER, realtimeCalls, resetStub, seed, table } from './test/helpers.ts';
import { readWorldVersion } from './world.ts';

// Prompt 13: stamps are claimed, never given; SQL (the stub here) decides from evidence.

const GUEST = '0b6f0b0e-2a4c-4d1e-9f3a-111111111111';
const BOOTH = '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a10';

describe('POST /api/passport/stamp', () => {
  beforeEach(resetStub);

  it('needs a session', async () => {
    const res = await api('/api/passport/stamp', { json: { stamps: ['squad'] } });
    expect(res.status).toBe(401);
  });

  it('refuses malformed keys and oversized batches before touching the database', async () => {
    for (const stamps of [['booths:3'], ['district:NOPE'], [], Array(9).fill('squad')]) {
      const res = await api('/api/passport/stamp', { token: 'owner-token', json: { stamps } });
      expect(res.status, JSON.stringify(stamps)).toBe(400);
      expect(await errorCode(res)).toBe('bad_request');
    }
    expect(await table('passport_stamps')).toEqual([]);
  });

  it('awards backed claims, keeps shard-backed ones pending and drops the rest', async () => {
    await seed({ passport_backed: [{ player: OWNER, stamp: 'district:ai-agents' }] });
    const res = await api('/api/passport/stamp', {
      token: 'owner-token',
      json: { stamps: ['district:ai-agents', 'district:dev-tools', 'first:note', 'squad'] },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      awarded: ['district:ai-agents'],
      // first:note is checked against the user's own rows: not held now means not earned.
      pending: ['district:dev-tools', 'squad'],
    });
    expect(await table('passport_stamps')).toEqual([
      { user_id: OWNER, stamp: 'district:ai-agents' },
    ]);
  });

  it('dedupes repeated claims', async () => {
    await seed({ passport_backed: [{ player: OWNER, stamp: 'squad' }] });
    const res = await api('/api/passport/stamp', {
      token: 'owner-token',
      json: { stamps: ['squad', 'squad'] },
    });
    expect(await res.json()).toEqual({ awarded: ['squad'], pending: [] });
  });

  it('is rate limited per user', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await api('/api/passport/stamp', {
        token: 'owner-token',
        json: { stamps: ['squad'] },
      });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});

describe('POST /api/passport/merge', () => {
  beforeEach(resetStub);

  it('merges what the guest evidence backs and caps the list', async () => {
    await seed({ passport_backed: [{ player: `guest:${GUEST}`, stamp: 'district:dev-tools' }] });
    const res = await api('/api/passport/merge', {
      token: 'owner-token',
      json: { guestId: GUEST, stamps: ['district:dev-tools', 'booths:100', 'first:upvote'] },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ awarded: ['district:dev-tools'], pending: ['booths:100'] });

    const tooMany = await api('/api/passport/merge', {
      token: 'owner-token',
      json: { guestId: GUEST, stamps: Array(65).fill('squad') },
    });
    expect(tooMany.status).toBe(400);
    const noGuest = await api('/api/passport/merge', {
      token: 'owner-token',
      json: { guestId: 'not-a-uuid', stamps: [] },
    });
    expect(noGuest.status).toBe(400);
  });

  it('gives nothing when the guest id already belongs to someone else', async () => {
    await seed({ guest_links: [{ guest_key: `guest:${GUEST}`, user_id: 'someone-else' }] });
    const res = await api('/api/passport/merge', {
      token: 'owner-token',
      json: { guestId: GUEST, stamps: ['district:dev-tools'] },
    });
    expect(await res.json()).toEqual({ awarded: [], pending: [] });
  });

  it('allows a few merges, then rate limits', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await api('/api/passport/merge', {
        token: 'owner-token',
        json: { guestId: GUEST, stamps: [] },
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe('POST /api/booths/:id/try', () => {
  beforeEach(resetStub);

  it('counts a click and refuses a malformed id', async () => {
    const res = await api(`/api/booths/${BOOTH}/try`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(await table('try_clicks')).toEqual([BOOTH]);
    expect((await api('/api/booths/nope/try', { method: 'POST' })).status).toBe(400);
  });
});

describe('nightly cron', () => {
  beforeEach(resetStub);

  it('bumps the world and tells the shards when tiers changed', async () => {
    const kv = (env as Env).KV;
    const before = await readWorldVersion(kv);
    await seed({ tier_changes: [{ booth_id: BOOTH, old_tier: 'stall', new_tier: 'booth' }] });
    const result = await runNightly(env as Env);
    expect(result.changed).toEqual([BOOTH]);
    expect(result.worldVersion).toBe(before + 1);
    expect(await realtimeCalls()).toEqual([['worldUpdate', [BOOTH]]]);
  });

  it('leaves the world alone when nothing changed', async () => {
    const result = await runNightly(env as Env);
    expect(result).toEqual({ changed: [], prunedEvidence: 0, worldVersion: null });
    expect(await realtimeCalls()).toEqual([]);
  });

  it('runs from the scheduled handler', async () => {
    await seed({ tier_changes: [{ booth_id: BOOTH, old_tier: 'booth', new_tier: 'pavilion' }] });
    const controller = { scheduledTime: Date.now(), cron: '0 3 * * *', noRetry() {} };
    await worker.scheduled(controller, env as Env, createExecutionContext());
    expect(await realtimeCalls()).toEqual([['worldUpdate', [BOOTH]]]);
  });
});

describe('GET /u/:handle', () => {
  beforeEach(resetStub);

  it('injects the maker and their stamp count', async () => {
    await seed({
      passport_stamps: [
        { user_id: OWNER, stamp: 'squad' },
        { user_id: OWNER, stamp: 'district:ai-agents' },
      ],
    });
    const res = await api('/u/maker1');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Maker One (@maker1) · ');
    expect(html).toContain('2 stamps collected');
    expect(html).toContain('/u/maker1"');
  });

  it('answers 404 for unknown and malformed handles', async () => {
    expect((await api('/u/nobody_here')).status).toBe(404);
    const bad = await api('/u/%3Cscript%3E');
    expect(bad.status).toBe(404);
    expect(await bad.text()).not.toContain('<script>');
  });
});
