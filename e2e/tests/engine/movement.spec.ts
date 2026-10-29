import { expect, test } from '@playwright/test';
import { boot, DT, report } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('jump: apex within 5% of 1.2 m, airtime within 5% of 0.633 s', async ({ page }) => {
  const result = await page.evaluate((dt) => {
    const api = window.__shipfair;
    if (!api) throw new Error('no test api');
    api.player.teleport(0, 0, 8, 0);
    api.step(dt, 30);
    const y0 = api.player.position.y;
    api.player.press('jump');
    let apex = 0;
    let air = 0;
    let wasAirborne = false;
    for (let i = 0; i < 240; i++) {
      api.step(dt);
      apex = Math.max(apex, api.player.position.y - y0);
      if (!api.player.isGrounded) {
        wasAirborne = true;
        air += dt;
      } else if (wasAirborne) break;
    }
    return { apexM: apex, airtimeS: air, landed: api.player.isGrounded, jumps: api.player.jumps };
  }, DT);
  report('apexM', result.apexM.toFixed(4));
  report('airtimeS', result.airtimeS.toFixed(4));
  expect(Math.abs(result.apexM - 1.2) / 1.2).toBeLessThan(0.05);
  expect(Math.abs(result.airtimeS - 0.633) / 0.633).toBeLessThan(0.05);
  expect(result.landed).toBe(true);
  expect(result.jumps).toBe(1);
});

test('steps: walk up the 0.3 m staircase onto the 1.2 m platform', async ({ page }) => {
  const result = await page.evaluate((dt) => {
    const api = window.__shipfair;
    const level = api?.level;
    const input = api?.player.input;
    if (!api || !level || !input) throw new Error('no test api');
    // Camera yaw π makes "forward" point along +z, up the stairs.
    api.player.teleport(level.stairsStart.x, 0, level.stairsStart.z, 0);
    api.camera.set(Math.PI, 0.22, 4.6);
    api.step(dt, 10);
    input.isActive = true;
    input.moveY = 1;
    let maxRise = 0;
    let frames = 0;
    while (frames < 300 && api.player.position.z < 14) {
      const before = api.player.position.y;
      api.step(dt);
      maxRise = Math.max(maxRise, api.player.position.y - before);
      frames++;
    }
    input.moveY = 0;
    api.step(dt, 30);
    input.isActive = false;
    const { x, y, z } = api.player.position;
    return { x, y, z, maxRise, seconds: frames * dt, target: level.platformTopY };
  }, DT);
  report('finalY', result.y.toFixed(4));
  report('maxRisePerStepM', result.maxRise.toFixed(3));
  report('secondsToClimb', result.seconds.toFixed(2));
  expect(Math.abs(result.y - result.target)).toBeLessThanOrEqual(0.02);
  expect(result.z).toBeGreaterThan(12.2);
});

test('input toggle: a disabled engine ignores keys', async ({ page }) => {
  const before = await page.evaluate(() => window.__shipfair?.player.position.z ?? 0);
  // The map is a modal sheet: while it is open the engine's input is off.
  await page.getByRole('button', { name: /^Map/ }).click();
  await expect(page.getByRole('dialog', { name: 'Map' })).toBeVisible();
  await page.keyboard.down('KeyW');
  await page.evaluate((dt) => window.__shipfair?.step(dt, 60), DT);
  await page.keyboard.up('KeyW');
  const during = await page.evaluate(() => window.__shipfair?.player.position.z ?? 0);
  expect(Math.abs(during - before)).toBeLessThan(1e-3);
  await page.getByRole('button', { name: 'Close map' }).click();
  await expect(page.getByRole('dialog', { name: 'Map' })).toBeHidden();
  await page.keyboard.down('KeyW');
  await page.evaluate((dt) => window.__shipfair?.step(dt, 60), DT);
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => window.__shipfair?.player.position.z ?? 0);
  report('metresWalkedAfterClose', Math.abs(after - during).toFixed(3));
  expect(Math.abs(after - during)).toBeGreaterThan(1);
});
