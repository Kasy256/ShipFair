import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { bootCity, serveFakeMedia } from '../engine/city-helpers.ts';
import { DT, report } from '../engine/helpers.ts';
import { loadBudgets } from './budgets.ts';
import { districts, VIEWS } from './route.ts';

// Prompt 14: the perf CI job. 500 booths (?debug=fake500) and 60 fake remote players in front of
// the camera, at a fixed 1280×720 and DPR 1, on the scripted route's four positions. Fails when
// draw calls, triangles or the estimated texture memory pass e2e/perf-budgets.json. SwiftShader
// renders on the CPU, so no frame rate is measured or asserted here.

const budgets = loadBudgets();
const { scenario } = budgets;

test.use({ viewport: scenario.viewport, deviceScaleFactor: 1 });

for (const tier of ['high', 'low'] as const) {
  test(`budgets: ${scenario.booths} booths and ${scenario.remotes} remotes on the route (${tier})`, async ({
    page,
  }, info) => {
    test.setTimeout(600_000);
    await serveFakeMedia(page);
    await bootCity(page, `quality=${tier}`, scenario.booths);
    const d = await districts(page);
    const budget = budgets.tiers[tier];
    const rows = [];
    for (const view of VIEWS) {
      const at = view.at(d);
      const result = await page.evaluate(
        async ({ v, pitch, distance, dt, remotes }) => {
          const api = window.__shipfair;
          if (!api) throw new Error('no test api');
          api.player.teleport(v.x, 0, v.z, v.yaw);
          api.camera.set(v.yaw + Math.PI, pitch, distance);
          // Visitors 6 m ahead, in view, where they cost the most (LOD0/LOD1 nearest).
          api.net.fake(remotes, 11, v.x + Math.sin(v.yaw) * 6, v.z + Math.cos(v.yaw) * 6);
          for (let i = 0; i < 3; i++) {
            api.step(dt, 30);
            await api.city.settled();
            await api.net.settled();
          }
          api.step(dt, 30);
          api.renderOnce(); // compiles shaders and uploads new textures
          const counts = api.renderOnce();
          const lods = [0, 0, 0];
          for (const r of api.net.remotes()) lods[r.lod] = (lods[r.lod] ?? 0) + 1;
          return {
            ...counts,
            textureMb: Math.round(api.perf.textureMb * 10) / 10,
            remotes: api.net.remotes().length,
            lods,
            standIns: api.net.drawn().standIns,
          };
        },
        { v: at, pitch: view.pitch, distance: view.distance, dt: DT, remotes: scenario.remotes },
      );
      rows.push({ view: view.name, ...result });
      report(`${tier} ${view.name}`, result);
      expect(result.remotes, view.name).toBe(scenario.remotes);
      expect(
        result.standIns,
        `${view.name}: far visitors use the instanced stand-in`,
      ).toBeGreaterThan(0);
      expect.soft(result.calls, `${view.name}: draw calls`).toBeLessThanOrEqual(budget.drawCalls);
      expect
        .soft(result.triangles, `${view.name}: triangles`)
        .toBeLessThanOrEqual(budget.triangles);
      expect
        .soft(result.textureMb, `${view.name}: texture MB`)
        .toBeLessThanOrEqual(budget.textureMb);
    }
    const peak = {
      calls: Math.max(...rows.map((r) => r.calls)),
      triangles: Math.max(...rows.map((r) => r.triangles)),
      textureMb: Math.max(...rows.map((r) => r.textureMb)),
    };
    report(`${tier} peak`, peak);
    // For the PR report and the CI artifact.
    writeFileSync(
      info.outputPath(`perf-${tier}.json`),
      `${JSON.stringify({ tier, budget, peak, rows }, null, 2)}\n`,
    );
  });
}
