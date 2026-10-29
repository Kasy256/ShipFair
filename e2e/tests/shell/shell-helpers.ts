import { type APIRequestContext, expect, type Page } from '@playwright/test';
import {
  type BoothPublic,
  boothAnchor,
  type CityLayout,
  type WorldSnapshot,
} from '@shipfair/shared';
import { DT, enterWorld } from '../engine/helpers.ts';

export { DT, enterWorld };

/**
 * The world the server is serving (the seeded Supabase in CI). Tests pick booths from it, so
 * they don't depend on particular seed rows.
 */
export async function serverWorld(request: APIRequestContext): Promise<WorldSnapshot> {
  const res = await request.get('/api/world');
  expect(res.status()).toBe(200);
  const world = (await res.json()) as WorldSnapshot;
  expect(world.booths.length).toBeGreaterThan(0);
  return world;
}

/** A booth with a distinctive name (so a name search finds it first), else the first one. */
export function pickBooth(world: WorldSnapshot, index = 0): BoothPublic {
  const booth = world.booths[index % world.booths.length];
  if (!booth) throw new Error('no booths');
  return booth;
}

/** Opens `path` in deterministic test mode, waits for the city, and clicks Enter. */
export async function openCity(page: Page, path = '/', query = 'quality=low'): Promise<void> {
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${sep}test&${query}`);
  await expect(page.getByRole('progressbar', { name: 'Loading the city' })).toBeVisible();
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-status', 'ready', {
    timeout: 60_000,
  });
  await page.waitForFunction(() => window.__shipfair?.city.hasBooths !== undefined);
  await enterWorld(page);
}

export async function playerPosition(page: Page): Promise<{ x: number; z: number }> {
  return page.evaluate(() => {
    const p = window.__shipfair?.player.position;
    return { x: p?.x ?? 0, z: p?.z ?? 0 };
  });
}

export async function cityLayout(page: Page): Promise<CityLayout> {
  const layout = await page.evaluate(() => window.__shipfair?.engine.layout ?? null);
  if (!layout) throw new Error('no city layout');
  return layout;
}

/** Metres from the player to a booth's anchor (the middle of its street-side edge). */
export async function distanceToBooth(page: Page, boothId: string): Promise<number> {
  const anchor = boothAnchor(await cityLayout(page), boothId);
  if (!anchor) throw new Error(`booth ${boothId} is not in the layout`);
  const p = await playerPosition(page);
  return Math.hypot(p.x - anchor.x, p.z - anchor.z);
}

/** Holds a key for `frames` deterministic engine steps. */
export async function holdKey(page: Page, key: string, frames: number): Promise<void> {
  await page.keyboard.down(key);
  await page.evaluate(([dt, n]) => window.__shipfair?.step(dt, n), [DT, frames] as const);
  await page.keyboard.up(key);
  await page.evaluate((dt) => window.__shipfair?.step(dt, 2), DT);
}
