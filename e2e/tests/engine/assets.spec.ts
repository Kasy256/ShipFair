import { expect, test } from '@playwright/test';
import { boot, DT, report } from './helpers.ts';

// Prompt 04b: built art in the running engine. Results depend on what `pnpm assets:build`
// produced; the status is reported so a placeholder-only run is visible in the report.

test('art loads and the local player becomes a glTF character', async ({ page }) => {
  await boot(page);
  const status = await page.evaluate(() => window.__shipfair?.assets.ready());
  report('assets', status);
  expect(status?.hasManifest).toBe(true);
  expect(status?.missing).toEqual([]);
  expect(status?.isAvatarGltf).toBe(true);
});

test('local player animates idle → walk → run → jump (deterministic steps)', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__shipfair?.assets.ready());
  const clips = await page.evaluate(async (dt) => {
    const api = window.__shipfair;
    if (!api) throw new Error('no test api');
    const seen: Record<string, string | null> = {};
    const input = api.player.input;
    if (!input) throw new Error('no scripted input');
    api.step(dt, 30);
    seen.standing = api.player.activeClip;
    input.isActive = true;
    input.moveY = 1;
    api.step(dt, 60);
    seen.walking = api.player.activeClip;
    input.run = true;
    api.step(dt, 60);
    seen.running = api.player.activeClip;
    api.player.press('jump');
    api.step(dt, 8);
    seen.jumping = api.player.activeClip;
    api.step(dt, 30);
    seen.inAir = api.player.activeClip;
    return seen;
  }, DT);
  report('clips', clips);
  expect(clips.standing).toBe('idle');
  expect(clips.walking).toBe('walk');
  expect(clips.running).toBe('run');
  expect(['jump_start', 'jump_air']).toContain(clips.jumping);
  expect(['jump_air', 'jump_land']).toContain(clips.inAir);
});

for (const tier of ['high', 'low'] as const) {
  test(`40 remote characters follow the LOD policy at 3 camera positions (${tier})`, async ({
    page,
  }) => {
    await boot(page, `quality=${tier}`);
    await page.evaluate(() => window.__shipfair?.assets.ready());
    const rows = await page.evaluate(async (dt) => {
      const api = window.__shipfair;
      if (!api) throw new Error('no test api');
      api.crowd.spawn(40, 7, 0, 0);
      const out: { at: number[]; target: number[]; shown: number[] }[] = [];
      for (const [x, z] of [
        [0, 0],
        [20, 20],
        [60, 0],
      ] as const) {
        api.player.teleport(x, 0.1, z);
        api.step(dt, 20);
        await api.crowd.settled();
        api.step(dt, 20);
        out.push({ at: [x, z], target: api.crowd.counts(), shown: api.crowd.shown() });
      }
      return out;
    }, DT);
    report('lods', rows);
    const caps = tier === 'high' ? [6, 12] : [3, 6];
    for (const row of rows) {
      expect(row.target[0]).toBeLessThanOrEqual(caps[0] ?? 0);
      expect(row.target[1]).toBeLessThanOrEqual(caps[1] ?? 0);
      expect(row.target.reduce((a, b) => a + b, 0)).toBe(40);
      expect(row.shown).toEqual(row.target);
    }
    // In the middle of the crowd every slot fills; 60 m away nobody is within LOD1 range.
    expect(rows[0]?.target).toEqual([caps[0], caps[1], 40 - (caps[0] ?? 0) - (caps[1] ?? 0)]);
    expect(rows[2]?.target[1]).toBe(0);
  });

  test(`budget: 500 booths and 40 characters (${tier})`, async ({ page }) => {
    await boot(page, `quality=${tier}`);
    await page.evaluate(() => window.__shipfair?.assets.ready());
    const result = await page.evaluate(async (dt) => {
      const api = window.__shipfair;
      if (!api) throw new Error('no test api');
      const city = api.stress.city(500);
      api.crowd.spawn(40, 7, 0, 10);
      api.step(dt, 20);
      await api.crowd.settled();
      api.step(dt, 20);
      api.renderOnce();
      return { city, counts: api.renderOnce(), lods: api.crowd.counts() };
    }, DT);
    report('city', result.city);
    report('drawCalls', result.counts.calls);
    report('triangles', result.counts.triangles);
    report('lods', result.lods);
    const budget =
      tier === 'high' ? { calls: 400, tris: 1_500_000 } : { calls: 150, tris: 400_000 };
    expect(result.city.booths).toBe(500);
    expect(result.counts.calls).toBeLessThanOrEqual(budget.calls);
    expect(result.counts.triangles).toBeLessThanOrEqual(budget.tris);
  });
}

test('/dev/assets lists every manifest entry with 0 console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const manifest = (await (
    await page.request.get('/assets/assets-manifest.generated.json')
  ).json()) as {
    characters: { id: string }[];
    props: { id: string }[];
    boothKit: { tiers: { id: string }[] };
    wardrobe: unknown[];
  };
  await page.goto('/dev/assets');
  const cards = page.getByTestId('asset-card');
  const expected =
    manifest.characters.length + manifest.props.length + manifest.boothKit.tiers.length;
  await expect(cards).toHaveCount(expected, { timeout: 60_000 });
  for (const c of manifest.characters)
    await expect(page.locator(`[data-asset="${c.id}"]`)).toBeVisible();
  await expect(page.getByTestId('wardrobe-row')).toHaveCount(manifest.wardrobe.length);
  await page.waitForTimeout(2000); // let the character builds settle
  report('cards', expected);
  report(
    'budgetRed',
    await page.locator('[data-testid="budget-status"][data-over="true"]').count(),
  );
  // allTextContents() doesn't wait: with nothing missing the list isn't rendered at all.
  report('missingAssets', await page.getByTestId('missing-assets').allTextContents());
  expect(errors).toEqual([]);
  // The page renders 37 viewports nonstop on a software GPU; leave it so teardown is quick.
  await page.goto('about:blank');
});
