import { expect, type Page, test } from '@playwright/test';
import { boot, enterWorld, report } from './helpers.ts';

// Prompt 14: a hidden tab renders nothing (the loop stops) and only the realtime client ticks;
// leaving the city route disposes the engine.
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

test('leaving the city for another page disposes the engine; coming back builds a new one', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // Test mode (no rAF): this is about the route change, not the loop.
  await boot(page, 'quality=high');
  const before = await page.evaluate(() => {
    const api = window.__shipfair;
    if (!api) throw new Error('no test api');
    api.step(1 / 60, 2);
    api.renderOnce();
    (window as unknown as { __oldEngine: unknown }).__oldEngine = api.engine;
    return {
      geometries: api.info?.memory.geometries ?? 0,
      textures: api.info?.memory.textures ?? 0,
    };
  });
  // A client-side navigation, as a link in the shell would do it.
  const go = (path: string) =>
    page.evaluate((to) => {
      history.pushState({}, '', to);
      dispatchEvent(new PopStateEvent('popstate'));
    }, path);
  await go('/rules');
  await expect(page.getByTestId('world-canvas')).toHaveCount(0);
  const after = await page.evaluate(() => {
    const old = (window as unknown as { __oldEngine: { isDisposed: boolean; runtime: unknown } })
      .__oldEngine;
    return {
      isDisposed: old.isDisposed,
      hasRuntime: old.runtime !== undefined,
      api: !!window.__shipfair,
    };
  });
  report('memoryWhileInCity', before);
  report('afterLeaving', after);
  expect(before.geometries).toBeGreaterThan(0);
  expect(after).toEqual({ isDisposed: true, hasRuntime: false, api: false });

  await go('/?test&level=test&quality=high');
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-status', 'ready', {
    timeout: 60_000,
  });
  const isNew = await page.evaluate(
    () => window.__shipfair?.engine !== (window as unknown as { __oldEngine: unknown }).__oldEngine,
  );
  expect(isNew).toBe(true);
});
