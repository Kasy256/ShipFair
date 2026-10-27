import { expect, type Page, test } from '@playwright/test';

export const DT = 1 / 60;

/**
 * Opens the world in deterministic test mode (no rAF: nothing moves unless a test steps it)
 * and waits for `window.__shipfair`.
 */
export async function boot(page: Page, query = 'quality=low'): Promise<void> {
  await page.goto(`/?test&${query}`);
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__shipfair !== undefined);
  // Art loads after start and swaps the procedural avatar for the glTF one (prompt 04b). Wait,
  // so draw counts never depend on how fast the files arrived.
  await page.evaluate(() => window.__shipfair?.assets.ready());
}

/** Records a measured number on the test (shown in the report) and in the log. */
export function report(name: string, value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  test.info().annotations.push({ type: name, description: text });
  console.log(`METRIC ${test.info().title} :: ${name} = ${text}`);
}
