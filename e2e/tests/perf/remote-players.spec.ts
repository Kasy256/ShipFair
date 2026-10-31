import { expect, test } from '@playwright/test';
import { bootCity } from '../engine/city-helpers.ts';
import { report } from '../engine/helpers.ts';

// Prompt 11: 60 remote players (fed through the real interpolation, LOD and stand-in path by the
// fake feed) on top of the 500-booth city must stay inside ARCHITECTURE.md §4 budgets.

const BUDGET = { high: { calls: 400, tris: 1_500_000 }, low: { calls: 150, tris: 400_000 } };
const REMOTES = 60;
const FRAMES = 60;

for (const tier of ['high', 'low'] as const) {
  test(`budget: 500 booths and ${REMOTES} remote players (${tier})`, async ({ page }) => {
    test.setTimeout(240_000);
    await bootCity(page, `quality=${tier}`, 500);

    const result = await page.evaluate(
      async ({ count, frames }) => {
        const api = window.__shipfair;
        if (!api) throw new Error('no test api');
        /** Average wall time of a stepped and rendered frame (SwiftShader: CPU-bound). */
        const frameMs = () => {
          const start = performance.now();
          for (let i = 0; i < frames; i++) {
            api.step(1 / 60, 1);
            api.renderOnce();
          }
          return (performance.now() - start) / frames;
        };
        api.renderOnce();
        const before = { counts: api.renderOnce(), frameMs: frameMs() };
        const p = api.player.position;
        api.net.fake(count, 11, p.x, p.z + 6);
        // LODs are assigned on the first frame; glTF builds finish async, then fade in (0.3 s).
        api.step(1 / 60, 30);
        await api.net.settled();
        api.step(1 / 60, 60);
        await api.net.settled();
        api.step(1 / 60, 30);
        api.renderOnce();
        const counts = api.renderOnce();
        const remotes = api.net.remotes();
        const lods = [0, 0, 0];
        for (const r of remotes) lods[r.lod] = (lods[r.lod] ?? 0) + 1;
        return {
          before,
          after: { counts, frameMs: frameMs() },
          remotes: remotes.length,
          lods,
          drawn: api.net.drawn(),
        };
      },
      { count: REMOTES, frames: FRAMES },
    );

    report(`${tier} without remotes`, {
      calls: result.before.counts.calls,
      triangles: result.before.counts.triangles,
      frameMs: Number(result.before.frameMs.toFixed(1)),
    });
    report(`${tier} with ${REMOTES} remotes`, {
      calls: result.after.counts.calls,
      triangles: result.after.counts.triangles,
      frameMs: Number(result.after.frameMs.toFixed(1)),
      lods: result.lods,
      drawn: result.drawn,
    });
    expect(result.remotes).toBe(REMOTES);
    expect(result.drawn.standIns).toBeGreaterThan(0);
    const budget = BUDGET[tier];
    expect(result.after.counts.calls).toBeLessThanOrEqual(budget.calls);
    expect(result.after.counts.triangles).toBeLessThanOrEqual(budget.tris);
  });
}
