import { expect, test } from '@playwright/test';
import { boot, DT, report } from './helpers.ts';

/** The bits of three.js the dispose baseline uses (e2e has no three typings). */
interface Disposable {
  dispose(): void;
}
interface ThreeModule {
  WebGLRenderer: new () => Disposable & {
    info: { memory: { geometries: number; textures: number } };
  };
  PMREMGenerator: new (
    renderer: unknown,
  ) => Disposable & { fromScene(scene: unknown, sigma: number): Disposable };
}
interface RoomModule {
  RoomEnvironment: new () => Disposable;
}

for (const tier of ['high', 'low'] as const) {
  test(`render budget: draw calls and triangles for the test level (${tier})`, async ({ page }) => {
    await boot(page, `quality=${tier}`);
    const counts = await page.evaluate((dt) => {
      const api = window.__shipfair;
      if (!api) throw new Error('no test api');
      api.step(dt, 30);
      api.renderOnce(); // first frame compiles shaders and uploads buffers
      return api.renderOnce();
    }, DT);
    report('drawCalls', counts.calls);
    report('triangles', counts.triangles);
    const budget =
      tier === 'high' ? { calls: 400, tris: 1_500_000 } : { calls: 150, tris: 400_000 };
    expect(counts.calls).toBeLessThanOrEqual(budget.calls);
    expect(counts.triangles).toBeLessThanOrEqual(budget.tris);
  });
}

test('dispose: renderer.info.memory returns to the baseline', async ({ page }) => {
  // High quality and the physics wireframe, so bloom targets, shadow maps and debug lines exist.
  await boot(page, 'quality=high&debug=physics,perf');
  const result = await page.evaluate(async (dt) => {
    const api = window.__shipfair;
    const info = api?.info;
    if (!api || !info) throw new Error('no test api');
    api.step(dt, 10);
    api.renderOnce();
    const live = { geometries: info.memory.geometries, textures: info.memory.textures };
    api.engine.dispose();
    const after = { geometries: info.memory.geometries, textures: info.memory.textures };
    const overlayGone = document.querySelector('[data-testid="perf-overlay"]') === null;

    // Baseline: what a bare renderer still counts after the same PMREM pass, with everything
    // disposed. three.js uploads a module-level 1×1 fallback texture (WebGLUniforms
    // `emptyTexture`) the first time a shader samples an unset map, and never releases it.
    // Variable specifiers keep TypeScript from resolving Vite's dev-server module ids.
    const threeId = '/@id/three';
    const roomId = '/@id/three/addons/environments/RoomEnvironment.js';
    const three = (await import(/* @vite-ignore */ threeId)) as ThreeModule;
    const { RoomEnvironment } = (await import(/* @vite-ignore */ roomId)) as RoomModule;
    const bare = new three.WebGLRenderer();
    const pmrem = new three.PMREMGenerator(bare);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    target.dispose();
    const baseline = {
      geometries: bare.info.memory.geometries,
      textures: bare.info.memory.textures,
    };
    bare.dispose();
    return { live, after, baseline, overlayGone };
  }, DT);
  report('baseline', result.baseline);
  report('whileRunning', result.live);
  report('afterDispose', result.after);
  expect(result.live.geometries).toBeGreaterThan(result.baseline.geometries);
  expect(result.live.textures).toBeGreaterThan(result.baseline.textures);
  expect(result.after).toEqual(result.baseline);
  expect(result.baseline.textures).toBeLessThanOrEqual(1);
  expect(result.overlayGone).toBe(true);
});

test('debug overlay: ?debug=perf shows live numbers', async ({ page }) => {
  await page.goto('/?quality=low&debug=perf');
  const overlay = page.getByTestId('perf-overlay');
  await expect(overlay).toContainText('fps', { timeout: 30_000 });
  await expect(overlay).toContainText(/draws [1-9]\d*/);
  await expect(overlay).toContainText(/geo [1-9]\d*/);
  report('overlayText', ((await overlay.textContent()) ?? '').replaceAll('\n', ' | '));
});

test('debug overlay: ?debug=physics draws the collider wireframe', async ({ page }) => {
  const drawCalls = async (query: string) => {
    await boot(page, query);
    return page.evaluate((dt) => {
      window.__shipfair?.step(dt, 2);
      window.__shipfair?.renderOnce();
      return window.__shipfair?.renderOnce().calls ?? 0;
    }, DT);
  };
  const plain = await drawCalls('quality=low');
  const withWireframe = await drawCalls('quality=low&debug=physics');
  report('drawCalls', { plain, withWireframe });
  expect(withWireframe).toBe(plain + 1);
});
