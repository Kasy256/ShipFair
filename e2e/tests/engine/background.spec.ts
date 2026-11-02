import { expect, type Page, test } from '@playwright/test';
import { enterWorld, report } from './helpers.ts';

// Prompt 14: a hidden tab renders nothing (the loop stops) and only the realtime client ticks.
// A live page (no ?test), so the rAF loop is really running. SwiftShader renders a live page at
// about 1 fps, so the test level and a tiny viewport keep each frame (and every click) short.

test.use({ viewport: { width: 320, height: 240 } });

/** Fakes the page becoming hidden or visible (Playwright pages are always "visible"). */
async function setHidden(page: Page, isHidden: boolean): Promise<void> {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, isHidden);
}

const frames = (page: Page) =>
  page.evaluate(() => window.__shipfair?.engine.runtime?.loop.frames ?? -1);

test('a hidden tab stops the loop; showing it starts again', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?level=test&quality=low');
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-status', 'ready', {
    timeout: 90_000,
  });
  await enterWorld(page);
  await expect.poll(() => frames(page)).toBeGreaterThan(2);

  await setHidden(page, true);
  await expect.poll(() => page.evaluate(() => window.__shipfair?.perf.isPaused)).toBe(true);
  const hiddenAt = await frames(page);
  await page.waitForTimeout(1500); // real time on purpose: nothing may advance while hidden
  const hiddenAfter = await frames(page);
  report('framesWhileHidden', hiddenAfter - hiddenAt);
  expect(hiddenAfter).toBe(hiddenAt);

  await setHidden(page, false);
  await expect.poll(() => page.evaluate(() => window.__shipfair?.perf.isPaused)).toBe(false);
  await expect.poll(() => frames(page)).toBeGreaterThan(hiddenAfter);
});
