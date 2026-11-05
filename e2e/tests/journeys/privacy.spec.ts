import { expect, type Page, type Request, test } from '@playwright/test';
import { report } from '../engine/helpers.ts';

// Privacy journey (prompt 15): Sentry and PostHog load only after the first interaction,
// anonymous visitors leave no PostHog cookie or storage, Global Privacy Control keeps PostHog
// away, and error reports carry no emails. `?telemetry=e2e` (non-production builds) turns both
// on with test keys; their hosts are answered here, so nothing leaves the machine.

const POSTHOG = /^https:\/\/eu\.i\.posthog\.com\//;
const SENTRY = /^https:\/\/o1\.ingest\.de\.sentry\.io\//;

interface Seen {
  posthog: Request[];
  sentry: string[];
}

async function intercept(page: Page): Promise<Seen> {
  const seen: Seen = { posthog: [], sentry: [] };
  await page.route(POSTHOG, (route) => {
    seen.posthog.push(route.request());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  await page.route(SENTRY, (route) => {
    seen.sentry.push(route.request().postData() ?? '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return seen;
}

/** Every PostHog trace the browser kept: cookies and both storages. */
async function posthogTraces(page: Page): Promise<string[]> {
  const cookies = (await page.context().cookies()).map((c) => c.name);
  const stored = await page.evaluate(() => [
    ...Object.keys(localStorage),
    ...Object.keys(sessionStorage),
  ]);
  return [...cookies, ...stored].filter((k) => /^ph_|posthog/i.test(k));
}

async function openCity(page: Page, extra = ''): Promise<void> {
  await page.goto(`/?test&quality=low&telemetry=e2e${extra}`);
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-status', 'ready', {
    timeout: 60_000,
  });
}

test.describe('privacy @full', () => {
  test('nothing loads before the first interaction; after it, events go out with no stored id', async ({
    page,
  }) => {
    const seen = await intercept(page);
    await openCity(page);
    expect(await page.evaluate(() => window.__shipfairSentry)).toBeUndefined();
    expect(seen.posthog).toHaveLength(0);

    await page.getByRole('button', { name: 'Enter' }).click();
    await page.waitForFunction(() => window.__shipfairSentry === 'loaded');
    await expect.poll(() => seen.posthog.length, { timeout: 20_000 }).toBeGreaterThan(0);
    report('posthog requests after Enter', seen.posthog.length);
    expect(await posthogTraces(page)).toEqual([]);

    // Opting in under Settings stores the anonymous id; opting out again removes it.
    await page.evaluate(() => {
      const raw = localStorage.getItem('shipfair:settings');
      localStorage.setItem(
        'shipfair:settings',
        JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), analytics: 'remember' }),
      );
    });
    await page.reload();
    await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-status', 'ready', {
      timeout: 60_000,
    });
    await page.getByRole('button', { name: 'Enter' }).click();
    await expect.poll(() => posthogTraces(page), { timeout: 20_000 }).not.toEqual([]);
  });

  test('Global Privacy Control: PostHog never loads', async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }),
    );
    const seen = await intercept(page);
    await openCity(page);
    await page.getByRole('button', { name: 'Enter' }).click();
    await page.waitForFunction(() => window.__shipfairSentry === 'loaded');
    await page.waitForLoadState('networkidle');
    expect(seen.posthog).toHaveLength(0);
    expect(await posthogTraces(page)).toEqual([]);
  });

  test('a boot error is queued, sent once Sentry loads, tagged, and without the email', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        throw new Error('boot boom for bob@example.com');
      });
    });
    const seen = await intercept(page);
    await openCity(page);
    expect(seen.sentry).toHaveLength(0);
    await page.getByRole('button', { name: 'Enter' }).click();
    await expect
      .poll(() => seen.sentry.find((body) => body.includes('boot boom')) ?? '', { timeout: 20_000 })
      .toContain('"phase":"boot"');
    const envelope = seen.sentry.find((body) => body.includes('boot boom')) ?? '';
    expect(envelope).not.toContain('bob@example.com');
    expect(envelope).toContain('[Filtered]');
    report('sentry envelopes', seen.sentry.length);
  });
});
