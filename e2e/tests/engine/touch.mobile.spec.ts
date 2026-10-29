import { expect, test } from '@playwright/test';
import { boot, DT, report } from './helpers.ts';

// Runs in the `mobile` project (Pixel 7 viewport, touch enabled).
test('touch: dragging the joystick moves the player forward > 2 m in 1 s', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('touch-controls')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jump' })).toBeVisible();

  const start = await page.evaluate((dt) => {
    const api = window.__shipfair;
    if (!api) throw new Error('no test api');
    api.player.teleport(0, 0, 8, Math.PI); // facing -z, open floor ahead
    api.camera.set(0, 0.22, 4.6); // camera behind, so "forward" is -z
    api.step(dt, 10);
    return api.player.position;
  }, DT);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const x = Math.round(viewport.width * 0.25);
  const y = Math.round(viewport.height * 0.7);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dy: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y: y + dy, id: 1 }],
    });
  await touch('touchStart', 0);
  for (const dy of [-10, -25, -40, -50]) await touch('touchMove', dy); // under the 56 px rim: walk
  // CDP returns before the page handles the last move; stepping first would walk with a
  // half-pushed stick. The knob (48 px, centred on the finger) shows when it has landed.
  await expect
    .poll(() => page.getByTestId('joystick-knob').getAttribute('style'))
    .toContain(`translate(${x - 24}px, ${y - 50 - 24}px)`);

  const end = await page.evaluate((dt) => {
    window.__shipfair?.step(dt, 60);
    return window.__shipfair?.player.position;
  }, DT);
  await touch('touchEnd', 0);
  if (!end) throw new Error('no position');

  const forward = start.z - end.z;
  report('metresForwardIn1s', forward.toFixed(3));
  report('sideways', Math.abs(end.x - start.x).toFixed(3));
  expect(forward).toBeGreaterThan(2);
  expect(Math.abs(end.x - start.x)).toBeLessThan(0.2);
});
