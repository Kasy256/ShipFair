import { expect, test } from '@playwright/test';
import { deleteTestUser } from '../auth/auth-helpers.ts';
import { DT, report } from '../engine/helpers.ts';
import { openCity } from '../shell/shell-helpers.ts';
import {
  boothsOf,
  decide,
  type Maker,
  median,
  newMaker,
  submitThroughForm,
} from './submit-helpers.ts';

// Prompt 08: the submit → review → live loop against local Supabase and local R2. Needs
// `pnpm dev` and `pnpm db:start`. Each test fills the whole form, so they are slow (software GL).

const formTimes: number[] = [];
let makers: Maker[] = [];

test.afterEach(async () => {
  for (const maker of makers) await deleteTestUser(maker.id);
  makers = [];
});

test.afterAll(() => {
  if (formTimes.length > 0) {
    console.log(
      `METRIC submit form :: median form ms = ${median(formTimes)} of ${formTimes.join(', ')}`,
    );
  }
});

test('a maker submits a booth, it is approved, and its logo shows in the city', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const maker = await newMaker();
  makers.push(maker);

  const filled = await submitThroughForm(page, maker, 11);
  formTimes.push(filled.formMs);
  report('form ms', filled.formMs);
  report('upload bytes (logo, screenshots)', filled.uploadBytes);
  expect(filled.uploadBytes).toHaveLength(3);
  expect(filled.uploadBytes[0]).toBeLessThanOrEqual(300 * 1024);

  const [booth] = await boothsOf(maker.id);
  expect(booth).toMatchObject({ status: 'pending', slug: 'e2e-booth-11' });
  expect(booth?.media).toHaveLength(2);
  // The Worker stores the real sizes it read from the files (1600×900 → 1280×720).
  expect(booth?.media[0]).toMatchObject({ w: 1280, h: 720 });

  await page.goto('/me');
  const row = page.getByTestId('my-booth').filter({ hasText: filled.name });
  await expect(row.getByTestId('status-chip')).toHaveText('In review');

  // Staff approve: media moves from pending/ to the public prefix, the world cache version bumps.
  if (!booth) throw new Error('no booth row');
  const privateRes = await page.request.get(`/${booth.logo_key}`);
  expect(privateRes.status(), 'unreviewed media is not served').toBe(404);
  await decide(page, booth.id, 'approve');
  const publicRes = await page.request.get(`/${booth.logo_key}`);
  expect(publicRes.status()).toBe(200);
  expect(publicRes.headers()['content-type']).toBe('image/webp');

  const world = await (await page.request.get('/api/world')).json();
  expect(world.booths.map((b: { id: string }) => b.id)).toContain(booth.id);

  // Spawn in front of it (the /b/:slug deep link) and wait for its logo texture.
  await openCity(page, `/b/${booth.slug}`);
  await expect
    .poll(
      async () =>
        page.evaluate(
          async ([id, dt]) => {
            const api = window.__shipfair;
            api?.step(dt, 20);
            await api?.city.settled();
            api?.step(dt, 20);
            return api?.city.content(id)?.logo ?? null;
          },
          [booth.id, DT] as const,
        ),
      { timeout: 60_000 },
    )
    .toMatch(new RegExp(`/${booth.logo_key}$`));
  const stats = await page.evaluate(() => window.__shipfair?.city.stats().cache);
  expect(stats?.failures).toBe(0);
});

test('a rejected booth shows "Changes needed" with the reason, and resubmits', async ({ page }) => {
  test.setTimeout(240_000);
  const maker = await newMaker();
  makers.push(maker);

  const filled = await submitThroughForm(page, maker, 21);
  formTimes.push(filled.formMs);
  report('form ms', filled.formMs);
  const [booth] = await boothsOf(maker.id);
  if (!booth) throw new Error('no booth row');
  await decide(page, booth.id, 'reject', 'Broken link: the page did not load');

  await page.goto('/me');
  const row = page.getByTestId('my-booth').filter({ hasText: filled.name });
  await expect(row.getByTestId('status-chip')).toHaveText('Changes needed');
  await expect(row.getByTestId('reject-reason')).toContainText(
    'Broken link: the page did not load',
  );

  // Edit and resubmit: the form opens with everything filled in; change the tagline and send.
  await row.getByTestId('edit-booth').click();
  await expect(page.getByLabel('Tagline')).toHaveValue('A booth made by the end-to-end tests');
  await page.getByLabel('Tagline').fill('Fixed: a booth made by the end-to-end tests');
  await page.getByRole('button', { name: '5. Submit' }).click();
  await page.getByTestId('rules-checkbox').check();
  await expect(page.getByTestId('submit-booth')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('submit-booth').click();
  await expect(page.getByTestId('submit-done')).toBeVisible({ timeout: 30_000 });

  const [after] = await boothsOf(maker.id);
  expect(after).toMatchObject({ id: booth.id, status: 'pending', reject_reason: null });
  await page.goto('/me');
  await expect(
    page.getByTestId('my-booth').filter({ hasText: filled.name }).getByTestId('status-chip'),
  ).toHaveText('In review');
});
