import { expect, test } from '@playwright/test';
import { APP_NAME, nearestBooth, SHARE_PANEL_DELAY_S } from '@shipfair/shared';
import { report } from '../engine/helpers.ts';
import {
  cityLayout,
  DT,
  distanceToBooth,
  enterWorld,
  holdKey,
  loadCity,
  openCity,
  pickBooth,
  playerPosition,
  serverWorld,
} from './shell-helpers.ts';

// Prompt 06: the web shell on the city the server serves (the seeded Supabase in CI). Engine time
// only moves through `__shipfair.step`; UI timers (the 1.5 s share delay) run in real time.

test('load → enter → walk to the nearest booth → open panel → Try it opens ref=shipfair', async ({
  page,
  request,
}) => {
  const world = await serverWorld(request);
  await openCity(page);
  await expect(page.getByTestId('hud-district')).toBeVisible();

  // The nearest booth to the plaza spawn, by anchor distance.
  const start = await playerPosition(page);
  const anchor = nearestBooth(await cityLayout(page), start.x, start.z, Number.POSITIVE_INFINITY);
  if (!anchor) throw new Error('no booth in the city');
  const booth = world.booths.find((b) => b.id === anchor.boothId);
  if (!booth) throw new Error('nearest booth is not in /api/world');

  // Teleport to its share spawn (5 m out, facing it), then walk in until the prompt shows.
  await page.evaluate(
    ([slug, dt]) => {
      window.__shipfair?.city.teleport({ kind: 'booth', slug });
      window.__shipfair?.step(dt, 5);
    },
    [booth.slug, DT] as const,
  );
  let frames = 0;
  while (frames < 300) {
    const focused = await page.evaluate(() => window.__shipfair?.city.focused ?? null);
    if (focused === booth.id) break;
    await holdKey(page, 'KeyW', 10);
    frames += 12;
  }
  report('framesToFocus', frames);
  const pill = page.getByTestId('prompt-pill');
  await expect(pill).toHaveText(new RegExp(`E\\s*Visit ${escapeRegExp(booth.name)}`));

  await holdKey(page, 'KeyE', 3);
  const panel = page.getByRole('dialog', { name: booth.name });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(booth.tagline)).toBeVisible();
  await expect(panel.getByRole('button', { name: /Sign in to vote/ })).toBeDisabled();

  // Booth sites are external; answer them locally.
  await page
    .context()
    .route(/^https:\/\/[^/]*example\.com\//, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>booth site</p>' }),
    );
  const [tab] = await Promise.all([
    page.context().waitForEvent('page'),
    panel.getByRole('link', { name: /Try it/ }).click(),
  ]);
  await tab.waitForLoadState('domcontentloaded');
  const opened = new URL(tab.url());
  report('tryItUrl', tab.url());
  expect(opened.searchParams.get('ref')).toBe('shipfair');
  expect(`${opened.origin}${opened.pathname}`).toBe(
    `${new URL(booth.url).origin}${new URL(booth.url).pathname}`,
  );
  // noopener: the new tab can't reach back into the city.
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  const events = await page.evaluate(() => (window.__shipfairEvents ?? []).map((e) => e.name));
  expect(events).toContain('booth_try_click');
  expect(events).toContain('booth_open');
});

test('/b/:slug spawns within 6 m of the booth and opens its panel after 1.5 s', async ({
  page,
  request,
}) => {
  const booth = pickBooth(await serverWorld(request), 3);
  await loadCity(page, `/b/${booth.slug}`);
  // Timed in the page: from just before the Enter click to the moment the dialog opens. Starting
  // before the click makes this an upper bound on the delay, so ">= 1.5 s" can't pass by luck.
  const clickedAt = await page.evaluate(() => performance.now());
  await enterWorld(page);
  const openedAt = await page.waitForFunction(
    () =>
      document.querySelector('dialog[open][data-testid="booth-panel"]') ? performance.now() : 0,
    undefined,
    { timeout: 10_000 },
  );
  const openedAfterMs = Math.round((await openedAt.jsonValue()) - clickedAt);
  report('panelOpenedAfterMs', openedAfterMs);
  expect(openedAfterMs).toBeGreaterThanOrEqual(SHARE_PANEL_DELAY_S * 1000);
  const panel = page.getByRole('dialog', { name: booth.name });
  await expect(panel).toBeVisible();

  const distance = await distanceToBooth(page, booth.id);
  report('spawnDistanceM', distance.toFixed(2));
  expect(distance).toBeLessThanOrEqual(6);

  // "Copy booth link" puts /b/:slug on the clipboard and says so.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await panel.getByRole('button', { name: 'Copy booth link' }).click();
  await expect(panel.getByText('Booth link copied')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).pathname).toBe(`/b/${booth.slug}`);
});

test('share links carry the booth title and description; unknown slugs are 404', async ({
  request,
}) => {
  const booth = pickBooth(await serverWorld(request), 1);
  const res = await request.get(`/b/${booth.slug}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  const decoded = html.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  expect(decoded).toContain(`<title>${booth.name} · ${APP_NAME}</title>`);
  expect(decoded).toContain(`<meta property="og:title" content="${booth.name} · ${APP_NAME}"`);
  expect(decoded).toContain(`<meta property="og:description" content="${booth.tagline}"`);
  expect(decoded).toContain(`<meta name="twitter:description" content="${booth.tagline}"`);
  expect(html).toMatch(/<meta property="og:image" content="https?:\/\/[^"]+\/og-placeholder\.png"/);

  const missing = await request.get('/b/no-such-booth-here');
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain('href="/"');
});

test('map search finds a booth and teleports there', async ({ page, request }) => {
  const world = await serverWorld(request);
  const booth = pickBooth(world, Math.floor(world.booths.length / 2));
  await openCity(page);

  await page.keyboard.press('m');
  const map = page.getByRole('dialog', { name: 'Map' });
  await expect(map).toBeVisible();
  await expect(map.getByTestId('you-are-here')).toBeVisible();
  await map.getByRole('searchbox', { name: 'Find a booth' }).fill(booth.name);
  const result = map
    .getByRole('list', { name: 'Search results' })
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(booth.name)}`) })
    .first();
  await result.click();
  await expect(map).toBeHidden();
  await page.evaluate((dt) => window.__shipfair?.step(dt, 5), DT);
  const distance = await distanceToBooth(page, booth.id);
  report('distanceAfterTravelM', distance.toFixed(2));
  expect(distance).toBeLessThanOrEqual(6);
  await expect(page.getByText(`Travelled to ${booth.name}`)).toBeVisible();
});

test('Esc closes the panel and input comes back (the player moves after closing)', async ({
  page,
  request,
}) => {
  const booth = pickBooth(await serverWorld(request), 2);
  await openCity(page, `/b/${booth.slug}`);
  const panel = page.getByRole('dialog', { name: booth.name });
  await expect(panel).toBeVisible({ timeout: 10_000 });

  // Face along the street (a quarter turn; straight back is the booth opposite).
  await page.evaluate((dt) => {
    const api = window.__shipfair;
    if (!api) return;
    const p = api.player.position;
    api.player.teleport(p.x, 0, p.z, api.player.yaw + Math.PI / 2);
    api.step(dt, 5);
  }, DT);
  const before = await playerPosition(page);
  await holdKey(page, 'KeyW', 40);
  const during = await playerPosition(page);
  expect(Math.hypot(during.x - before.x, during.z - before.z)).toBeLessThan(0.01);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await holdKey(page, 'KeyW', 40);
  const after = await playerPosition(page);
  const moved = Math.hypot(after.x - during.x, after.z - during.z);
  report('metresWalkedAfterEsc', moved.toFixed(2));
  expect(moved).toBeGreaterThan(1);
});

test('keyboard: focus stays in the panel, Esc closes it, ? toggles the help', async ({
  page,
  request,
}) => {
  const world = await serverWorld(request);
  const booth = world.booths.find((b) => b.media.length > 1) ?? pickBooth(world);
  await openCity(page, `/b/${booth.slug}`);
  const panel = page.getByRole('dialog', { name: booth.name });
  await expect(panel).toBeVisible({ timeout: 10_000 });
  // The modal panel traps focus however far you Tab.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  const help = page.getByTestId('controls-help');
  const wasVisible = await help.isVisible();
  await page.keyboard.press('?');
  await expect(help).toBeVisible({ visible: !wasVisible });
  await page.keyboard.press('?');
  await expect(help).toBeVisible({ visible: wasVisible });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
