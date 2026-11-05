import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeWorld } from '@shipfair/shared/fake-world';
import { report } from '../engine/helpers.ts';
import { serveBuild } from './static-server.ts';

// Load time on a simulated Moto G Power-class phone (Lighthouse's 4× CPU slowdown) over Chrome
// DevTools' network presets, against a production build served gzip-compressed with a 500-booth
// world (static-server.ts). Opt-in: `pnpm build`, then E2E_PERF=1 (E2E_BUILD_DIR overrides the
// build folder). WebGL here is SwiftShader on the CPU, so the shader stage takes far longer than
// on a phone GPU; the report gives every stage's time so that can be split out.

test.describe('load time @full', () => {
  const PROFILES = {
    // DevTools presets; the latency includes their packet-level multiplier.
    'fast 4G': { latency: 165, down: 9_000_000, up: 1_500_000, isHttp2: false },
    'slow 4G': { latency: 562.5, down: 1_600_000, up: 750_000, isHttp2: false },
    // As Cloudflare serves it: one HTTP/2 connection instead of HTTP/1.1's six per host.
    'fast 4G over HTTP/2': { latency: 165, down: 9_000_000, up: 1_500_000, isHttp2: true },
  } as const;

  type Marks = Record<string, number>;

  test.use({
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    // The HTTP/2 server uses a throwaway self-signed certificate.
    ignoreHTTPSErrors: true,
  });

  for (const [name, profile] of Object.entries(PROFILES)) {
    test(`load: time to "Enter" and JS transferred, ${name}, 4× CPU`, async ({ page }) => {
      test.skip(!process.env.E2E_PERF, 'Set E2E_PERF=1 after `pnpm build` to measure.');
      test.setTimeout(600_000);
      const root = resolve(process.env.E2E_BUILD_DIR ?? '../apps/web/dist/client');
      const server = await serveBuild(root, fakeWorld(500), { isHttp2: profile.isHttp2 });
      try {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: profile.latency,
          downloadThroughput: (profile.down * 0.9) / 8,
          uploadThroughput: (profile.up * 0.9) / 8,
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const scripts = new Map<string, { url: string; bytes: number }>();
        cdp.on('Network.responseReceived', (e) => {
          // Scripts, plus Rapier's .wasm (a fetch: vite.config.ts takes it out of the compat build).
          const isWasm = /\/rapier-[\w-]+\.wasm$/.test(e.response.url);
          if (e.type === 'Script' || isWasm) {
            scripts.set(e.requestId, { url: e.response.url, bytes: 0 });
          }
        });
        cdp.on('Network.loadingFinished', (e) => {
          const s = scripts.get(e.requestId);
          if (s) s.bytes = e.encodedDataLength;
        });
        // Page-clock time of each loading stage (the progress bar's label) and of "Enter".
        await page.addInitScript(() => {
          const marks: Record<string, number> = {};
          (window as unknown as { __loadMarks: Record<string, number> }).__loadMarks = marks;
          // Cumulative layout shift (× 1000) while loading: "no layout shift on the loading screen".
          marks.clsX1000 = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
              if (!shift.hadRecentInput)
                marks.clsX1000 = (marks.clsX1000 ?? 0) + shift.value * 1000;
            }
          }).observe({ type: 'layout-shift', buffered: true });
          new MutationObserver(() => {
            const label = document
              .querySelector('[role="progressbar"]')
              ?.getAttribute('aria-valuetext');
            if (label && marks[label] === undefined) marks[label] = Math.round(performance.now());
            const buttons = [...document.querySelectorAll('button')];
            const enter = buttons.find((b) => b.textContent === 'Enter');
            if (enter && !enter.disabled && marks.enter === undefined) {
              marks.enter = Math.round(performance.now());
            }
          }).observe(document, { subtree: true, childList: true, attributes: true });
        });

        await page.goto(`${server.url}/?quality=low`, { waitUntil: 'commit' });
        await expect(page.getByRole('button', { name: 'Enter' })).toBeEnabled({ timeout: 580_000 });
        const marks = await page.evaluate(() => {
          const paint = performance.getEntriesByName('first-contentful-paint')[0];
          const recorded = (window as unknown as { __loadMarks: Record<string, number> })
            .__loadMarks;
          return { ...recorded, fcp: Math.round(paint?.startTime ?? -1) };
        });
        const all = [...scripts.values()];
        const kb = (list: typeof all) =>
          Math.round(list.reduce((sum, s) => sum + s.bytes, 0) / 1024);
        const isRapier = (s: { url: string }) => /\/rapier-[\w-]+\.(js|wasm)$/.test(s.url);
        report('stagesMs', marks satisfies Marks);
        report('jsKbExclRapier', kb(all.filter((s) => !isRapier(s))));
        report('rapierKb', kb(all.filter(isRapier)));
        report(
          'protocol',
          await page.evaluate(
            () =>
              (
                performance.getEntriesByType('navigation')[0] as
                  | PerformanceNavigationTiming
                  | undefined
              )?.nextHopProtocol ?? 'unknown',
          ),
        );
        report(
          'scripts',
          all.map((s) => `${new URL(s.url).pathname} ${(s.bytes / 1024).toFixed(0)} KB`).join(', '),
        );
        // The waterfall: when each script and the world were requested and arrived (page clock).
        const waterfall = await page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .filter((e) => /\.js$|\/api\/world$/.test(e.name))
            .map((e) => {
              const r = e as PerformanceResourceTiming;
              const file = new URL(r.name).pathname.replace('/assets/', '');
              return `${file} ${Math.round(r.startTime)}→${Math.round(r.responseEnd)}`;
            })
            .join(', '),
        );
        report('waterfallMs', waterfall);
        // The engine's own boot marks (engine/core/boot-marks.ts): physics, city, shaders.
        const bootMarks = await page.evaluate(() =>
          Object.fromEntries(
            performance
              .getEntriesByType('mark')
              .filter((m) => m.name.startsWith('shipfair:'))
              .map((m) => [m.name.slice('shipfair:'.length), Math.round(m.startTime)]),
          ),
        );
        report('engineMarksMs', bootMarks);
      } finally {
        await server.close();
      }
    });
  }
});
