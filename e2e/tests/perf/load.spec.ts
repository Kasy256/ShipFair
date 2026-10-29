import { expect, test } from '@playwright/test';
import { report } from '../engine/helpers.ts';

// Load timing on a simulated mid-range phone: Lighthouse's mobile preset (4× CPU slowdown,
// 150 ms RTT, 1.6 Mbps down / 750 kbps up). Opt-in (E2E_PERF=1) and meant for a production
// build (`vite preview`): the dev server serves unbundled, uncompressed modules. WebGL here is
// SwiftShader on the CPU, so the shader stage is far slower than on a real phone GPU.

const SLOW_4G = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};

test.use({
  viewport: { width: 412, height: 823 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
});

test('load: JS transferred and time to "Enter" on a throttled mid-range phone', async ({
  page,
}) => {
  test.skip(!process.env.E2E_PERF, 'Set E2E_PERF=1 (against a production build) to measure.');
  test.setTimeout(300_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const scripts = new Map<string, { url: string; bytes: number }>();
  cdp.on('Network.responseReceived', (e) => {
    if (e.type === 'Script') scripts.set(e.requestId, { url: e.response.url, bytes: 0 });
  });
  cdp.on('Network.loadingFinished', (e) => {
    const s = scripts.get(e.requestId);
    if (s) s.bytes = e.encodedDataLength;
  });

  const started = Date.now();
  await page.goto('/?quality=low', { waitUntil: 'commit' });
  await expect(page.getByRole('progressbar', { name: 'Loading the city' })).toBeVisible({
    timeout: 60_000,
  });
  const loadingScreenMs = Date.now() - started;
  await expect(page.getByRole('button', { name: 'Enter' })).toBeEnabled({ timeout: 280_000 });
  const enterMs = Date.now() - started;

  const paint = await page.evaluate(() =>
    Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1),
  );
  const jsKb = [...scripts.values()].reduce((sum, s) => sum + s.bytes, 0) / 1024;
  report('firstContentfulPaintMs', paint);
  report('loadingScreenVisibleMs', loadingScreenMs);
  report('enterEnabledMs', enterMs);
  report('jsTransferredKb', jsKb.toFixed(0));
  report(
    'scripts',
    [...scripts.values()]
      .map((s) => `${new URL(s.url).pathname} ${(s.bytes / 1024).toFixed(0)} KB`)
      .join(', '),
  );
});
