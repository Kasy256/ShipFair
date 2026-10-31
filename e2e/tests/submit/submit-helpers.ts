import { expect, type Page } from '@playwright/test';
import { adminCall, type Staff } from '../admin/admin-helpers.ts';
import {
  createTestUser,
  finishOnboarding,
  localSupabase,
  serviceHeaders,
  signIn,
  type TestUser,
  uniqueHandle,
} from '../auth/auth-helpers.ts';
import { stripedPng } from '../engine/city-helpers.ts';

// Prompt 08 e2e: a maker fills /submit for real (images go through the browser pipeline, the
// sign endpoint and the dev upload route into local R2). Staff decisions go through the admin
// API as a test staff account.

export interface Maker extends TestUser {
  handle: string;
}

export async function newMaker(): Promise<Maker> {
  const user = await createTestUser();
  const handle = uniqueHandle('maker');
  await finishOnboarding(user.id, handle);
  return { ...user, handle };
}

export interface FilledBooth {
  name: string;
  /** Milliseconds from the empty form to "Submitted for review". */
  formMs: number;
  /** WebP sizes the browser asked to upload, in bytes (logo first). */
  uploadBytes: number[];
}

const png = (w: number, h: number, seed: number) => ({
  name: `image-${seed}.png`,
  mimeType: 'image/png',
  buffer: stripedPng(w, h, seed),
});

/** Signs in on /submit and fills every step with a logo and 2 screenshots, then submits. */
export async function submitThroughForm(
  page: Page,
  maker: Maker,
  seed: number,
): Promise<FilledBooth> {
  const uploadBytes: number[] = [];
  page.on('request', (req) => {
    if (req.url().endsWith('/api/uploads/sign')) {
      uploadBytes.push((req.postDataJSON() as { bytes: number }).bytes);
    }
  });
  await page.goto('/submit');
  await signIn(page, maker);
  const name = `E2E Booth ${seed}`;
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible({ timeout: 30_000 });
  const started = Date.now();

  // 1. Basics
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Tagline').fill('A booth made by the end-to-end tests');
  await expect(page.getByTestId('tagline-count')).toContainText('36 / 90');
  await page.getByLabel('Link', { exact: true }).fill('https://example.com/');
  await page.getByLabel('District').selectOption({ index: 1 });
  await page.getByTestId('step-next').click();

  // 2. Media
  await page.getByTestId('logo-input').setInputFiles(png(600, 600, seed));
  await expect(page.getByTestId('logo-thumb')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('screenshot-input').setInputFiles(png(1600, 900, seed + 1));
  await expect(page.getByTestId('screenshot-list').locator('li')).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.getByTestId('screenshot-input').setInputFiles(png(1400, 1000, seed + 2));
  await expect(page.getByTestId('screenshot-list').locator('li')).toHaveCount(2, {
    timeout: 30_000,
  });
  await page.getByTestId('step-next').click();

  // 3. Details
  await page
    .getByLabel('Description')
    .fill('Made to check the whole submit, review and live loop.');
  await page.getByTestId('step-next').click();

  // 4. Preview: the real stall shell with the uploaded logo, and the first screenshot on the
  // stall's one screen (stalls have a single screen slot; booths and pavilions have two)
  await expect(page.getByTestId('booth-preview')).toHaveAttribute('data-status', 'ready', {
    timeout: 60_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.__shipfairBoothPreview?.stats ?? null))
    .toMatchObject({ hasLogo: true, screens: 1 });
  await page.getByTestId('step-next').click();

  // 5. Submit: rules, Turnstile (always-pass test key), submit
  await page.getByTestId('rules-checkbox').check();
  await expect(page.getByTestId('submit-booth')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('submit-booth').click();
  await expect(page.getByTestId('submit-done')).toHaveText('Submitted for review', {
    timeout: 30_000,
  });
  return { name, formMs: Date.now() - started, uploadBytes };
}

export interface BoothRow {
  id: string;
  slug: string;
  status: string;
  logo_key: string | null;
  media: { key: string; w: number; h: number }[];
  reject_reason: string | null;
}

export async function boothsOf(ownerId: string): Promise<BoothRow[]> {
  const res = await fetch(
    `${localSupabase().url}/rest/v1/booths?owner_id=eq.${ownerId}&select=id,slug,status,logo_key,media,reject_reason`,
    { headers: serviceHeaders() },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as BoothRow[];
}

/** A moderator's decision through the admin API (the queue UI itself is tested in admin/). */
export function decide(
  page: Page,
  staff: Staff,
  boothId: string,
  decision: 'approve' | 'reject',
  reject: { reason: string; note?: string } = { reason: 'other', note: 'Rejected by the tests' },
): Promise<void> {
  return adminCall(
    page.request,
    staff,
    'POST',
    `/api/admin/booths/${boothId}/${decision}`,
    decision === 'reject' ? reject : {},
  );
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
