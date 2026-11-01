import { type Browser, expect, type Page, test } from '@playwright/test';
import { report } from '../engine/helpers.ts';
import { openConnected, RealtimeServer, startBots, waitForPlayers } from './net-helpers.ts';

// Prompt 11: two real browser contexts plus 20 load-test bots on a private realtime server.
// A is stepped by hand (deterministic movement). B waits in real time and is stepped one frame
// right before each look, so it draws A at "now − 180 ms" on the real clock (see openConnected
// for why B isn't left on rAF). The specs share the server, so they run in order, and the
// restart test goes last.

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const BOTS = 20;
const SAMPLES = 20;
const MAX_ERROR_M = 0.5;
/**
 * Emote latency: the median must be within 300 ms. Single trials are only held to 1 s, because
 * locally every frame goes through `wrangler dev`'s one Node WebSocket proxy, shared with 20 bots
 * at 10 Hz, which now and then holds a frame for ~0.5 s (one in five trials on the dev laptop).
 * Staging (prompt 15) has no such proxy.
 */
const EMOTE_MEDIAN_MAX_MS = 300;
const EMOTE_ANY_MAX_MS = 1000;
/** Cheer, clap, point, wave, sit (twice): a different emote from the last one every trial. */
const EMOTES = [3, 1, 4, 0, 5, 3, 1, 4, 0, 5];

const server = new RealtimeServer();
let bots: { stop(): Promise<void> } | null = null;
let a: Page;
let b: Page;
let aId = -1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** Where B draws A right now (null while B doesn't show A). */
async function seenOnB(): Promise<{ x: number; z: number } | null> {
  return b.evaluate((id) => {
    window.__shipfair?.step(1 / 60, 1);
    const r = window.__shipfair?.net.remotes().find((p) => p.id === id);
    return r ? { x: r.x, z: r.z } : null;
  }, aId);
}

test.beforeAll(async ({ browser }) => {
  await server.start();
  bots = startBots(BOTS, 600);
  // Let the bots finish joining first: a fresh local server answering 20 joins and two pages
  // compiling shaders on a software GPU at once timed the pages' joins out.
  report('bots connected', await waitForPlayers(BOTS));
  a = await newPage(browser);
  b = await newPage(browser);
  await openConnected(a);
  const shard = await a.evaluate(() => window.__shipfair?.net.shard ?? null);
  expect(shard).not.toBeNull();
  await openConnected(b, { query: `with=${shard}` });
  aId = await a.evaluate(() => window.__shipfair?.net.you ?? -1);
  expect(aId).toBeGreaterThanOrEqual(0);
});

test.afterAll(async () => {
  await bots?.stop();
  await a?.context().close();
  await b?.context().close();
  await server.stop();
});

test('B sees A walk a route within 0.5 m of where A really is', async () => {
  await expect.poll(seenOnB, { timeout: 15_000 }).not.toBeNull();
  const errors: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    // A walks one leg (0.5 s of game time) in 0.1 s chunks paced in real time, so the server's
    // speed check sees a walking player, then stops and lets the idle move go out.
    await a.evaluate(
      (yaw) => {
        const api = window.__shipfair;
        const input = api?.player.input;
        if (!api || !input) return;
        api.camera.set(yaw, 0.22, 4.6);
        input.isActive = true;
        input.moveX = 0;
        input.moveY = 1;
      },
      (i * 2.4) % (2 * Math.PI),
    );
    for (let k = 0; k < 5; k++) {
      await a.evaluate(() => window.__shipfair?.step(1 / 60, 6));
      await sleep(100);
    }
    await a.evaluate(() => {
      const input = window.__shipfair?.player.input;
      if (input) input.isActive = false;
    });
    for (let k = 0; k < 5; k++) {
      await a.evaluate(() => window.__shipfair?.step(1 / 60, 6));
      await sleep(100);
    }
    // B: real time for the snapshot, the 180 ms render delay and the network.
    await sleep(600);
    const truth = await a.evaluate(() => window.__shipfair?.player.position ?? null);
    const seen = await seenOnB();
    expect(truth).not.toBeNull();
    expect(seen).not.toBeNull();
    if (truth && seen) errors.push(Math.hypot(truth.x - seen.x, truth.z - seen.z));
  }
  const max = Math.max(...errors);
  report('A→B position error (m)', {
    samples: errors.length,
    max: Number(max.toFixed(3)),
    mean: Number((errors.reduce((s, e) => s + e, 0) / errors.length).toFixed(3)),
  });
  expect(errors).toHaveLength(SAMPLES);
  expect(max).toBeLessThanOrEqual(MAX_ERROR_M);
  report('B sees', await b.evaluate(() => window.__shipfair?.net.remotes().length ?? 0));
});

test('an emote from A plays on B within 300 ms', async () => {
  const latencies: number[] = [];
  for (const emote of EMOTES) {
    const sentAt = await a.evaluate((e) => {
      const t = performance.timeOrigin + performance.now();
      window.__shipfair?.net.emote(e);
      return t;
    }, emote);
    // B stamps the moment the emote arrives and starts playing (both pages share this machine's
    // clock); the glTF clip then cross-fades in over 0.2 s.
    await expect
      .poll(
        () =>
          b.evaluate(
            (id) => window.__shipfair?.net.remotes().find((p) => p.id === id)?.emoteAt ?? 0,
            aId,
          ),
        { timeout: 5000 },
      )
      .toBeGreaterThan(sentAt);
    const playedAt = await b.evaluate(
      (id) => window.__shipfair?.net.remotes().find((p) => p.id === id)?.emoteAt ?? 0,
      aId,
    );
    expect(
      await b.evaluate(
        (id) => window.__shipfair?.net.remotes().find((p) => p.id === id)?.emote,
        aId,
      ),
    ).toBe(emote);
    latencies.push(Math.round(playedAt - sentAt));
    await sleep(1600); // the server relays at most one emote a second (on its own clock)
  }
  const sorted = [...latencies].sort((x, y) => x - y);
  const median = ((sorted[4] ?? 0) + (sorted[5] ?? 0)) / 2;
  report('emote A→B latency (ms)', { trials: latencies, median, max: sorted.at(-1) });
  expect(median).toBeLessThanOrEqual(EMOTE_MEDIAN_MAX_MS);
  expect(sorted.at(-1)).toBeLessThanOrEqual(EMOTE_ANY_MAX_MS);
  // And it really plays: B's view of A shows the clip (glTF) or the stand-in emote.
  const clip = await b.evaluate((id) => {
    window.__shipfair?.step(1 / 60, 20);
    return window.__shipfair?.net.remotes().find((p) => p.id === id)?.clip ?? null;
  }, aId);
  report('B shows A playing', clip);
  expect(clip).toMatch(/^(emote_sit|stand-in:5)$/);
});

test('?with=w-2 lands in shard w-2', async ({ browser }) => {
  const c = await newPage(browser);
  await openConnected(c, { query: 'with=w-2' });
  expect(await c.evaluate(() => window.__shipfair?.net.shard)).toBe('w-2');
  await expect(c.getByTestId('invite-friend')).toBeVisible();
  await c.context().close();
});

test('the HUD counts visitors nearby and online', async () => {
  const nearby = Number(await b.getByTestId('visitors-nearby').textContent());
  report('visitors nearby on B', nearby);
  // B itself, A, and the bots walking around the plaza (the AOI is 60 m).
  expect(nearby).toBeGreaterThanOrEqual(2);
});

test('killing the realtime server: Reconnecting, still walkable, then back with a new hello', async () => {
  const hellos = await b.evaluate(() => window.__shipfair?.net.stats.hellos ?? 0);
  await bots?.stop();
  bots = null;
  await server.stop();
  await expect(b.getByTestId('net-pill')).toHaveAttribute('data-status', /reconnecting|offline/, {
    timeout: 15_000,
  });
  await expect(b.getByTestId('net-pill')).toContainText(/Reconnecting|Offline, exploring solo/);
  report('pill after kill', await b.getByTestId('net-pill').getAttribute('data-status'));

  // The world stays walkable while offline (A is stepped by hand).
  const before = await a.evaluate(() => window.__shipfair?.player.position ?? null);
  await a.evaluate(() => {
    const input = window.__shipfair?.player.input;
    if (input) Object.assign(input, { isActive: true, moveX: 0, moveY: 1 });
    window.__shipfair?.step(1 / 60, 60);
    if (input) input.isActive = false;
  });
  const after = await a.evaluate(() => window.__shipfair?.player.position ?? null);
  const walked = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
  report('walked while offline (m)', Number(walked.toFixed(2)));
  expect(walked).toBeGreaterThan(1);

  const restartAt = Date.now();
  await server.start();
  await expect(b.getByTestId('net-pill')).toHaveAttribute('data-status', 'online', {
    timeout: 60_000,
  });
  report('reconnected after restart (ms)', Date.now() - restartAt);
  expect(await b.evaluate(() => window.__shipfair?.net.stats.hellos ?? 0)).toBeGreaterThan(hellos);
});
