import { expect, type Page, test } from '@playwright/test';
import { PROTOCOL_VERSION } from '@shipfair/shared';
import { decodeClient, encodeClient } from '@shipfair/shared/codec';
import { enterWorld, report } from '../engine/helpers.ts';
import { openConnected, RealtimeServer } from '../net/net-helpers.ts';

// Resilience journey (prompt 15): what a visitor sees when parts of the stack fail. The realtime
// server is this spec's own (ports 8899/9243), because one test stops and restarts it; pages are
// stepped by hand (net-helpers.ts), so nothing waits on frame timing.

test.describe('resilience @full', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  const server = new RealtimeServer({ port: 8899, inspectorPort: 9243 });

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    await server.start();
  });

  test.afterAll(async () => {
    await server.stop();
  });

  /** Walks forward for 60 stepped frames; returns the metres covered. */
  async function walk(page: Page): Promise<number> {
    return page.evaluate(() => {
      const api = window.__shipfair;
      if (!api) return 0;
      const input = api.player.input;
      const before = { ...api.player.position };
      if (input) Object.assign(input, { isActive: true, moveX: 0, moveY: 1 });
      api.step(1 / 60, 60);
      if (input) input.isActive = false;
      const after = api.player.position;
      return Math.hypot(after.x - before.x, after.z - before.z);
    });
  }

  test('/api/world failing shows Retry, and Retry loads the city once it is back', async ({
    page,
  }) => {
    let failures = 0;
    let isDown = true;
    await page.route(
      (url) => url.pathname === '/api/world',
      async (route) => {
        if (!isDown) return route.continue();
        failures++;
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'internal', message: 'test outage' } }),
        });
      },
    );
    await page.goto('/?test&quality=low');
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/booth list isn't loading|couldn't reach the server/),
    ).toBeVisible();
    report('world requests failed before Retry showed', failures);
    expect(failures).toBeGreaterThanOrEqual(1);

    isDown = false;
    await retry.click();
    await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-status', 'ready', {
      timeout: 60_000,
    });
    await page.waitForFunction(() => window.__shipfair?.city.hasBooths === true);
  });

  test('an outdated client gets the refresh banner and keeps exploring solo', async ({ page }) => {
    // Rewrites the client's hello to protocol v0, as an old cached bundle would send it; every
    // other frame passes through untouched, both ways.
    let rewritten = 0;
    await page.routeWebSocket(/\/parties\/world-shard\//, (ws) => {
      const shard = ws.connectToServer();
      ws.onMessage((message) => {
        if (typeof message === 'string') return shard.send(message);
        const decoded = decodeClient(new Uint8Array(message));
        if (decoded.ok && decoded.value.type === 'hello') {
          rewritten++;
          return shard.send(Buffer.from(encodeClient({ ...decoded.value, v: 0 })));
        }
        return shard.send(message);
      });
    });
    await page.goto(`/?test&debug=fake60&quality=low&realtime=${server.host}`);
    await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-status', 'ready', {
      timeout: 60_000,
    });
    await enterWorld(page);
    await page.evaluate(() => window.__shipfair?.step(1 / 60, 2));

    const banner = page.getByTestId('update-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText('A new version of ShipFair is out');
    expect(rewritten).toBeGreaterThanOrEqual(1);
    report('client protocol', { real: PROTOCOL_VERSION, sent: 0 });
    // No reconnect storm: a refused version is final until the page is refreshed.
    const hellos = await page.evaluate(() => window.__shipfair?.net.stats.hellos ?? 0);
    expect(await walk(page)).toBeGreaterThan(1);
    expect(await page.evaluate(() => window.__shipfair?.net.stats.hellos ?? 0)).toBe(hellos);
  });

  test('realtime going down: Reconnecting, still walkable, then online again', async ({ page }) => {
    await openConnected(page, { host: server.host });
    const hellos = await page.evaluate(() => window.__shipfair?.net.stats.hellos ?? 0);
    await server.stop();

    const pill = page.getByTestId('net-pill');
    await expect(pill).toHaveAttribute('data-status', /reconnecting|offline/, { timeout: 15_000 });
    await expect(pill).toContainText(/Reconnecting|Offline, exploring solo/);
    const walked = await walk(page);
    report('walked while realtime was down (m)', Number(walked.toFixed(2)));
    expect(walked).toBeGreaterThan(1);

    const restartAt = Date.now();
    await server.start();
    await expect(pill).toHaveAttribute('data-status', 'online', { timeout: 60_000 });
    report('back online after restart (ms)', Date.now() - restartAt);
    expect(await page.evaluate(() => window.__shipfair?.net.stats.hellos ?? 0)).toBeGreaterThan(
      hellos,
    );
  });
});
