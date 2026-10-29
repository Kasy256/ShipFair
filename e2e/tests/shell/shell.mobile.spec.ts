import { expect, test } from '@playwright/test';
import { report } from '../engine/helpers.ts';
import { DT, openCity, pickBooth, playerPosition, serverWorld } from './shell-helpers.ts';

// Runs in the `mobile` project (touch). The prompt's phone size: 390 × 844.
test.use({ viewport: { width: 390, height: 844 } });

test('mobile: the booth panel is a bottom sheet, and the joystick walks after closing it', async ({
  page,
  request,
}) => {
  const booth = pickBooth(await serverWorld(request), 4);
  await openCity(page, `/b/${booth.slug}`);
  const panel = page.getByRole('dialog', { name: booth.name });
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const box = await panel.boundingBox();
  if (!box) throw new Error('panel has no box');
  report('sheetBox', { x: box.x, y: box.y, width: box.width, height: box.height });
  // Full width, pinned to the bottom edge.
  expect(box.x).toBeCloseTo(0, 0);
  expect(box.width).toBeCloseTo(390, 0);
  expect(box.y + box.height).toBeCloseTo(844, 0);

  await panel.getByRole('button', { name: 'Close booth panel' }).tap();
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('touch-controls')).toBeVisible();

  // Face along the street (a quarter turn from the booth; straight back is the booth opposite),
  // then drag the left-thumb joystick up for 1 s.
  await page.evaluate((dt) => {
    const api = window.__shipfair;
    if (!api) return;
    const p = api.player.position;
    const yaw = api.player.yaw + Math.PI / 2;
    api.player.teleport(p.x, 0, p.z, yaw);
    api.camera.set(yaw + Math.PI, 0.22, 4.6);
    api.step(dt, 10);
  }, DT);
  const start = await playerPosition(page);
  const cdp = await page.context().newCDPSession(page);
  const x = Math.round(390 * 0.25);
  const y = Math.round(844 * 0.7);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dy: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y: y + dy, id: 1 }],
    });
  await touch('touchStart', 0);
  for (const dy of [-10, -25, -40, -50]) await touch('touchMove', dy);
  // CDP returns before the page handles the last move; stepping first would walk with a
  // half-pushed stick. The knob (48 px, centred on the finger) shows when it has landed.
  await expect
    .poll(() => page.getByTestId('joystick-knob').getAttribute('style'))
    .toContain(`translate(${x - 24}px, ${y - 50 - 24}px)`);
  await page.evaluate((dt) => window.__shipfair?.step(dt, 60), DT);
  await touch('touchEnd', 0);
  const end = await playerPosition(page);
  const moved = Math.hypot(end.x - start.x, end.z - start.z);
  report('metresWalkedIn1s', moved.toFixed(2));
  expect(moved).toBeGreaterThan(2);
});
