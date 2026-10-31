import { expect, test } from '@playwright/test';
import { bootCity } from '../engine/city-helpers.ts';

// Prompt 11: on touch screens, holding the Use button opens the emote wheel; a tap still uses.

test('mobile: holding Use opens the emote wheel, and Dance plays on the local avatar', async ({
  page,
}) => {
  await bootCity(page, 'quality=low', 60);
  const use = page.getByRole('button', { name: 'Use' });
  await use.dispatchEvent('pointerdown');
  await page.waitForTimeout(700);
  await use.dispatchEvent('pointerup');
  // The menu itself is a 0×0 anchor; its six buttons sit on a circle around it.
  const menu = page.getByRole('menu', { name: 'Emotes' });
  const dance = menu.getByRole('menuitem', { name: 'Dance' });
  await expect(dance).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(6);
  await dance.click();
  await expect(menu).toHaveCount(0);
  const clip = await page.evaluate(() => {
    window.__shipfair?.step(1 / 60, 30);
    return window.__shipfair?.player.activeClip;
  });
  expect(clip).toBe('emote_dance');
  // A quick tap does not open the wheel.
  await use.dispatchEvent('pointerdown');
  await use.dispatchEvent('pointerup');
  await page.waitForTimeout(700);
  await expect(menu).toHaveCount(0);
});
