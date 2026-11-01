import { type Browser, expect, type Page, test } from '@playwright/test';
import { fakeWorld } from '@shipfair/shared/fake-world';
import { deleteStaff, newStaff, type Staff } from '../admin/admin-helpers.ts';
import {
  createTestUser,
  deleteTestUser,
  finishOnboarding,
  signIn,
  type TestUser,
  uniqueHandle,
} from '../auth/auth-helpers.ts';
import { report } from '../engine/helpers.ts';
import { openConnected, RealtimeServer } from '../net/net-helpers.ts';

// Prompt 12: proximity chat, mute and report with two signed-in contexts (A, B) and a guest (C)
// on a private realtime server (net-helpers.ts). A and B stand at the plaza spawn; C spawns at a
// district gate, well outside the 15 m chat radius. Tokens come from local Supabase, which the
// realtime Worker verifies against its JWKS; reports go to local Supabase too.

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

/** The 20 lines a report keeps, plus two that fall off the front. */
const B_LINES = 22;
/** The shard's chat bucket refills one message per 1.5 s. */
const CHAT_GAP_MS = 1600;

const server = new RealtimeServer();
let userA: TestUser;
let userB: TestUser;
let staff: Staff;
let a: Page;
let b: Page;
let c: Page;
let aId = -1;
let bId = -1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

/** Opens the connected city, signs in, and waits for the signed-in hello to be welcomed. */
async function signedIn(page: Page, user: TestUser, query?: string): Promise<number> {
  await openConnected(page, query ? { query } : {});
  await signIn(page, user);
  await page.waitForFunction(
    () => {
      const net = window.__shipfair?.net;
      return net !== undefined && net.stats.hellos >= 2 && net.status === 'online' && net.you >= 0;
    },
    undefined,
    { timeout: 60_000 },
  );
  // A stepped page announces its position only while frames run.
  await page.evaluate(() => window.__shipfair?.step(1 / 60, 2));
  return page.evaluate(() => window.__shipfair?.net.you ?? -1);
}

/** Waits until `page` shows remote player `id`. */
async function sees(page: Page, id: number): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((who) => {
          window.__shipfair?.step(1 / 60, 1);
          return window.__shipfair?.net.remotes().some((r) => r.id === who && !r.isLeaving);
        }, id),
      { timeout: 20_000 },
    )
    .toBe(true);
}

const bubbles = (page: Page) => page.evaluate(() => window.__shipfair?.net.bubbles() ?? []);

/** Clicks remote player `id` where `page` draws them, which opens their player card. */
async function clickPlayer(page: Page, id: number): Promise<void> {
  const at = await page.evaluate((who) => {
    window.__shipfair?.step(1 / 60, 1);
    return window.__shipfair?.net.screenOf(who) ?? null;
  }, id);
  if (!at) throw new Error(`player ${id} is not on screen`);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('player-card')).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  // Three pages, two sign-ins and a realtime server: slower than the default hook budget on CI.
  test.setTimeout(300_000);
  await server.start();
  userA = await createTestUser();
  userB = await createTestUser();
  await finishOnboarding(userA.id, uniqueHandle('chat_a'));
  await finishOnboarding(userB.id, uniqueHandle('chat_b'));
  staff = await newStaff();
  a = await newPage(browser);
  b = await newPage(browser);
  c = await newPage(browser);
  // The guest joins first and spawns at a district gate (a deep link places the first move
  // anywhere); A and B follow it into its shard. Three pages joining at once on the dev laptop
  // timed the last one's coordinator call out.
  const district = fakeWorld(60, 7).districts[0]?.slug;
  await openConnected(c, { path: `/d/${district}` });
  // openConnected steps before the welcome can arrive; once online, a frame sends the real spot.
  await c.evaluate(() => window.__shipfair?.step(1 / 60, 2));
  const shard = await c.evaluate(() => window.__shipfair?.net.shard ?? null);
  expect(shard).not.toBeNull();
  aId = await signedIn(a, userA, `with=${shard}`);
  bId = await signedIn(b, userB, `with=${shard}`);
  await sees(a, bId);
  await sees(b, aId);
});

test.afterAll(async () => {
  for (const page of [a, b, c]) await page?.context().close();
  await server.stop();
  if (userA) await deleteTestUser(userA.id);
  if (userB) await deleteTestUser(userB.id);
  await deleteStaff(staff);
});

test('A says hi near B: B sees a bubble and a log line; C, a guest far away, sees nothing', async () => {
  const pa = await a.evaluate(() => window.__shipfair?.player.position);
  const pc = await c.evaluate(() => window.__shipfair?.player.position);
  const apart = Math.hypot((pa?.x ?? 0) - (pc?.x ?? 0), (pa?.z ?? 0) - (pc?.z ?? 0));
  report('guest distance from A (m)', apart.toFixed(1));
  expect(apart).toBeGreaterThan(20);

  // Guests can't type.
  await expect(c.getByTestId('chat-input')).toBeDisabled();
  await expect(c.getByTestId('chat-input')).toHaveAttribute('placeholder', 'Sign in to chat');

  await a.keyboard.press('Enter');
  await a.getByTestId('chat-input').fill('hi');
  await a.getByTestId('chat-input').press('Enter');

  await expect(b.getByTestId('chat-line').filter({ hasText: 'hi' })).toBeVisible();
  await expect
    .poll(() => bubbles(b))
    .toContainEqual(expect.objectContaining({ speaker: aId, text: 'hi' }));
  // A sees their own line and bubble (speaker −1 is the local player).
  await expect(a.getByTestId('chat-line').filter({ hasText: 'hi' })).toBeVisible();
  expect(await bubbles(a)).toContainEqual(expect.objectContaining({ speaker: -1, text: 'hi' }));
  // The log is a polite live region.
  await expect(b.getByTestId('chat-log')).toHaveAttribute('aria-live', 'polite');

  await sleep(1500);
  await expect(c.getByTestId('chat-line')).toHaveCount(0);
  expect(await bubbles(c)).toEqual([]);
});

test("B mutes A: A's next message isn't shown to B", async () => {
  await clickPlayer(b, aId);
  const mute = b.getByTestId('player-mute');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await b.keyboard.press('Escape');
  await expect(b.getByTestId('player-card')).toBeHidden();

  await sleep(CHAT_GAP_MS);
  await a.evaluate(() => window.__shipfair?.engine.sendChat('this one is muted'));
  await expect(a.getByTestId('chat-line').filter({ hasText: 'this one is muted' })).toBeVisible();
  await sleep(1500);
  await expect(b.getByTestId('chat-line').filter({ hasText: 'this one is muted' })).toHaveCount(0);
  expect((await bubbles(b)).map((x) => x.text)).not.toContain('this one is muted');
});

test('A reports B: the report reaches admin with 20 lines of context', async ({ request }) => {
  for (let i = 1; i <= B_LINES; i++) {
    await b.evaluate((n) => window.__shipfair?.engine.sendChat(`b line ${n}`), i);
    await sleep(CHAT_GAP_MS);
  }
  await expect(a.getByTestId('chat-line').filter({ hasText: `b line ${B_LINES}` })).toBeVisible();

  await clickPlayer(a, bId);
  await a.getByTestId('player-report').click();
  const form = a.getByTestId('report-form');
  await expect(form).toContainText('Their last 20 chat lines you saw will be attached.');
  await form.getByLabel('Reason').selectOption('hate');
  await form.getByRole('button', { name: 'Send report' }).click();
  await expect(a.getByTestId('report-sent')).toBeVisible();

  // The inbox lists the most reported first, so a new single report may be on a later page.
  type Group = {
    targetType: string;
    targetId: string;
    reports: { reason: string; context: { text: string }[] | null }[];
  };
  let group: Group | undefined;
  let cursor: string | null = null;
  for (let pageNo = 0; pageNo < 20 && !group; pageNo++) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const res = await request.get(`/api/admin/reports${query}`, {
      headers: { authorization: `Bearer ${staff.token}` },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { items: Group[]; nextCursor: string | null };
    group = body.items.find((g) => g.targetType === 'user' && g.targetId === userB.id);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  expect(group).toBeDefined();
  const context = group?.reports[0]?.context ?? [];
  report('report context lines', context.length);
  expect(group?.reports[0]?.reason).toBe('hate');
  expect(context).toHaveLength(20);
  expect(context[0]?.text).toBe('b line 3');
  expect(context.at(-1)?.text).toBe(`b line ${B_LINES}`);
});
