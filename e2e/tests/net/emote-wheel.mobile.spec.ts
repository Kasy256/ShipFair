import { expect, test } from '@playwright/test';
import { bootCity } from '../engine/city-helpers.ts';

// Prompt 11, reworked in prompt 14: the Emote button opens the wheel; Use only shows while there
// is something to use, so it no longer doubles as the wheel's long-press.

test('mobile: the Emote button opens the wheel, and Dance plays on the local avatar', async ({
  page,
}) => {
  await bootCity(page, 'quality=low', 60);
  const emote = page.getByRole('button', { name: 'Emote' });
  await emote.tap();
  // The menu itself is a 0×0 anchor; its six buttons sit on a circle around it.
  const menu = page.getByRole('menu', { name: 'Emotes' });
  const dance = menu.getByRole('menuitem', { name: 'Dance' });
  await expect(dance).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(6);
  // Every wheel button is fully on screen (the wheel moved with the safe-area offsets).
  const viewport = page.viewportSize();
  for (const item of await menu.getByRole('menuitem').all()) {
    const box = await item.boundingBox();
    expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);
  }
  await dance.click();
  await expect(menu).toHaveCount(0);
  const clip = await page.evaluate(() => {
    window.__shipfair?.step(1 / 60, 30);
    return window.__shipfair?.player.activeClip;
  });
  expect(clip).toBe('emote_dance');
});

test('mobile: Use shows only in front of a booth, and opens it', async ({ page }) => {
  await bootCity(page, 'quality=low', 60);
  const use = page.getByRole('button', { name: 'Use' });
  // The plaza spawn is away from booths, the kiosk and the wall.
  await expect(use).toBeHidden();
  const slug = await page.evaluate(() => Object.values(window.__shipfair?.city.slugs() ?? {})[0]);
  if (!slug) throw new Error('no booth');
  await page.evaluate((to) => {
    window.__shipfair?.city.teleport({ kind: 'booth', slug: to });
    window.__shipfair?.step(1 / 60, 10);
  }, slug);
  // Teleport puts the player 5 m out; focus is 3 m. Walk up to the counter.
  await page.evaluate(() => {
    const api = window.__shipfair;
    if (!api) return;
    const p = api.player.position;
    const yaw = api.player.yaw;
    api.player.teleport(p.x + Math.sin(yaw) * 3, 0, p.z + Math.cos(yaw) * 3, yaw);
    api.step(1 / 60, 10);
  });
  await expect(use).toBeVisible();
  await use.dispatchEvent('pointerdown');
  // Test mode: the press is read on the next fixed step.
  await page.evaluate(() => window.__shipfair?.step(1 / 60, 2));
  await expect(page.getByTestId('booth-panel')).toBeVisible();
});
