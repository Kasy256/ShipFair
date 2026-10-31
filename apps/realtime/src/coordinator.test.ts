import { runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { pickShard } from './coordinator.ts';
import { testEnv } from './test/client.ts';

// MAX_PLAYERS_PER_SHARD is 4 in tests, so "under 90%" means a load of 3 or less.

const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);

let n = 0;
/** A private coordinator instance per test (production only ever uses `main`). */
function coordinator() {
  const stub = testEnv.Coordinator.get(testEnv.Coordinator.idFromName(`test-${++n}`));
  return {
    assign: (requested?: string, exclude?: string, now = T0) =>
      runInDurableObject(stub, (c) => c.assign(requested, exclude, now)),
    report: (shard: string, population: number, now = T0) =>
      runInDurableObject(stub, (c) => c.report(shard, population, now)),
    health: (now = T0) => runInDurableObject(stub, (c) => c.health(now)),
  };
}

describe('pickShard', () => {
  it('fills the most-full shard under 90%, lowest number on ties', () => {
    const loads = [
      { name: 'w-1', load: 1 },
      { name: 'w-2', load: 3 },
      { name: 'w-3', load: 3 },
      { name: 'w-4', load: 4 },
    ];
    expect(pickShard(loads, 4)).toBe('w-2');
  });

  it('opens w-<n+1> after the highest shard when every shard is 90% full', () => {
    expect(pickShard([], 60)).toBe('w-1');
    expect(
      pickShard(
        [
          { name: 'w-1', load: 54 },
          { name: 'w-3', load: 60 },
        ],
        60,
      ),
    ).toBe('w-4');
  });

  it('honours a requested shard unless it is full', () => {
    expect(pickShard([{ name: 'w-2', load: 3 }], 4, 'w-2')).toBe('w-2');
    expect(pickShard([{ name: 'w-2', load: 4 }], 4, 'w-2')).toBe('w-3');
    expect(pickShard([], 4, 'w-9')).toBe('w-9');
  });
});

describe('Coordinator', () => {
  it('assigns the first player to w-1 and keeps filling it', async () => {
    const c = coordinator();
    expect(await c.assign()).toBe('w-1');
    await c.report('w-1', 2, T0 + 1);
    expect(await c.assign(undefined, undefined, T0 + 2)).toBe('w-1');
  });

  it('counts assignments as reservations, so a burst spreads before the next report', async () => {
    const c = coordinator();
    const burst = [];
    for (let i = 0; i < 9; i++) burst.push(await c.assign(undefined, undefined, T0 + i));
    // Loads 0–3 fit under 90% of 4, so each shard takes four before the next opens.
    expect(burst).toEqual(['w-1', 'w-1', 'w-1', 'w-1', 'w-2', 'w-2', 'w-2', 'w-2', 'w-3']);
  });

  it('overflows to a new shard when the reports say the others are full', async () => {
    const c = coordinator();
    await c.report('w-1', 4);
    await c.report('w-2', 4);
    expect(await c.assign(undefined, undefined, T0 + 1)).toBe('w-3');
  });

  it('forgets reservations after 15 s and shards after 30 s without a report', async () => {
    const c = coordinator();
    for (let i = 0; i < 4; i++) await c.assign(undefined, undefined, T0);
    expect(await c.assign(undefined, undefined, T0 + 1000)).toBe('w-2');
    // 16 s later every reservation has expired: w-1 is empty again.
    expect(await c.assign(undefined, undefined, T0 + 16_000)).toBe('w-1');

    await c.report('w-5', 3, T0 + 20_000);
    expect((await c.health(T0 + 49_000)).shards.map((s) => s.name)).toContain('w-5');
    expect((await c.health(T0 + 51_000)).shards.map((s) => s.name)).not.toContain('w-5');
  });

  it('honours a requested shard if not full, and never sends someone back to `exclude`', async () => {
    const c = coordinator();
    await c.report('w-1', 1);
    await c.report('w-2', 2);
    expect(await c.assign('w-1', undefined, T0 + 1)).toBe('w-1');
    await c.report('w-2', 4, T0 + 2);
    expect(await c.assign('w-2', undefined, T0 + 3)).toBe('w-1');
    expect(await c.assign(undefined, 'w-1', T0 + 4)).toBe('w-3');
  });

  it('keeps counting a reservation after a report, until it expires', async () => {
    const c = coordinator();
    for (let i = 0; i < 4; i++) await c.assign(undefined, undefined, T0);
    // The shard reports before any of those four has connected: w-1 must still look full.
    await c.report('w-1', 0, T0 + 1000);
    expect(await c.assign(undefined, undefined, T0 + 2000)).toBe('w-2');
  });

  it('reports shard populations and totals', async () => {
    const c = coordinator();
    expect(await c.report('w-1', 3)).toEqual({ total: 3 });
    expect(await c.report('w-2', 5)).toEqual({ total: 8 });
    expect(await c.health()).toEqual({
      ok: true,
      shards: [
        { name: 'w-1', population: 3, reserved: 0 },
        { name: 'w-2', population: 5, reserved: 0 },
      ],
      totals: { players: 8, shards: 2 },
    });
  });

  it('ignores reports for names that are not shards', async () => {
    const c = coordinator();
    await c.report('main', 3);
    await c.report('w-1', -1);
    expect((await c.health()).shards).toEqual([]);
  });
});

describe('public routes', () => {
  const get = (path: string, init?: RequestInit) =>
    exports.default.fetch(`https://rt.test${path}`, init);

  it('GET /parties/coordinator/main/join returns a shard', async () => {
    const res = await get('/parties/coordinator/main/join');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ shard: expect.stringMatching(/^w-\d+$/) });
    const friend = await get('/parties/coordinator/main/join?shard=w-77');
    expect(await friend.json()).toEqual({ shard: 'w-77' });
    const junk = await get('/parties/coordinator/main/join?shard=../../x');
    expect(await junk.json()).toEqual({ shard: expect.stringMatching(/^w-\d+$/) });
  });

  it('refuses every other coordinator and shard path', async () => {
    expect((await get('/parties/coordinator/other/join')).status).toBe(404);
    expect((await get('/parties/coordinator/main/health')).status).toBe(404);
    expect((await get('/parties/coordinator/main/join', { method: 'POST' })).status).toBe(404);
    expect((await get('/parties/world-shard/w-1')).status).toBe(404); // not a WebSocket
    const notAShard = await get('/parties/world-shard/main', { headers: { Upgrade: 'websocket' } });
    expect(notAShard.status).toBe(404);
    const toCoordinator = await get('/parties/coordinator/main', {
      headers: { Upgrade: 'websocket' },
    });
    expect(toCoordinator.status).toBe(404);
  });

  it('GET /health lists shards and totals', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; totals: { players: number } };
    expect(body.ok).toBe(true);
    expect(body.totals.players).toBeGreaterThanOrEqual(0);
  });
});
