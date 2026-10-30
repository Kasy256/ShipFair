import { expect, test } from '@playwright/test';
import { guestName } from '@shipfair/shared';
import { report } from '../engine/helpers.ts';
import { openCity } from '../shell/shell-helpers.ts';
import {
  createTestUser,
  deleteTestUser,
  finishOnboarding,
  profileRow,
  signIn,
  type TestUser,
  uniqueHandle,
} from './auth-helpers.ts';

// Prompt 07: guests, sign-in (local email + password stands in for OAuth), onboarding, the avatar
// editor's live preview and world avatar, sign-out, and account deletion. Needs local Supabase.

let user: TestUser | undefined;

test.afterEach(async () => {
  if (user) await deleteTestUser(user.id);
  user = undefined;
});

/** The open preview's item-set key, and the world avatar's. */
const keys = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    preview: window.__shipfairPreview?.key ?? '',
    world: window.__shipfair?.player.avatarKey ?? '',
    worldTop: JSON.parse(window.__shipfair?.player.styleJson ?? '{}')?.top?.item as string,
  }));

test('sign in → onboarding → handle → avatar change shows in the preview and the world', async ({
  page,
}) => {
  user = await createTestUser();
  await openCity(page);
  await page.evaluate(() => window.__shipfair?.assets.ready());
  await signIn(page, user);

  const sheet = page.getByTestId('onboarding-sheet');
  await expect(sheet).toBeVisible();
  const handle = uniqueHandle('e2e');
  await sheet.getByLabel('Handle').fill(handle);
  await expect(sheet.getByText(`@${handle} is available`)).toBeVisible();
  await sheet.getByLabel('Display name').fill('E2E Maker');

  // The preview opens with the profile's (default) look and waves.
  await expect(sheet.getByTestId('avatar-preview')).toHaveAttribute('data-status', 'ready', {
    timeout: 60_000,
  });
  // Its own live WebGL context (StrictMode mounts it twice in dev; each instance owns a canvas).
  expect(await page.evaluate(() => window.__shipfairPreview?.isContextLost)).toBe(false);
  const before = await keys(page);
  report('keys before', before);
  expect(before.preview).not.toContain('top:hoodie');

  await sheet.getByRole('tab', { name: 'Top' }).click();
  await sheet.getByRole('radio', { name: 'Hoodie' }).check({ force: true });
  // Both rebuild in the background; the preview and the world avatar swap in the hoodie.
  await expect
    .poll(async () => (await keys(page)).preview, { timeout: 30_000 })
    .toContain('top:hoodie');
  await expect.poll(async () => (await keys(page)).worldTop).toBe('hoodie');
  await expect
    .poll(async () => (await keys(page)).world, { timeout: 30_000 })
    .toContain('top:hoodie');
  report('keys after', await keys(page));

  await sheet.getByRole('button', { name: 'Save and enter the city' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('hud-account')).toHaveText(`@${handle}`);
  await expect.poll(() => page.evaluate(() => window.__shipfair?.player.name)).toBe(handle);
  // The preview's renderer is gone with the sheet.
  expect(await page.evaluate(() => window.__shipfairPreview === undefined)).toBe(true);

  const row = await profileRow(user.id);
  expect(row?.handle).toBe(handle);
  expect(row?.display_name).toBe('E2E Maker');
  expect(row?.onboarded_at).not.toBeNull();
  expect(row?.avatar_style.top?.item).toBe('hoodie');
});

test('a guest can change their look (not their name) and keeps it after a reload', async ({
  page,
}) => {
  await openCity(page);
  const name = await page.getByTestId('hud-name').textContent();
  expect(name).toMatch(/^You're Guest-\d{4}$/);
  const guestId = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('shipfair:guest') ?? '{}') as { id?: string }).id ?? '',
  );
  expect(name).toBe(`You're ${guestName(guestId)}`);

  await page.getByRole('button', { name: 'Avatar' }).click();
  const sheet = page.getByTestId('avatar-sheet');
  await sheet.getByRole('tab', { name: 'Skin' }).click();
  await sheet.getByRole('radio', { name: 'Skin tone 12 of 12' }).check({ force: true });
  await expect
    .poll(() => page.evaluate(() => JSON.parse(window.__shipfair?.player.styleJson ?? '{}').skin))
    .toBe(11);
  await sheet.getByRole('button', { name: 'Save look' }).click();
  await expect(sheet).toBeHidden();
  // No name field for guests.
  await expect(page.getByLabel('Handle')).toHaveCount(0);

  await page.reload();
  await openCity(page);
  expect(
    await page.evaluate(() => JSON.parse(window.__shipfair?.player.styleJson ?? '{}').skin),
  ).toBe(11);
  await expect(page.getByTestId('hud-name')).toHaveText(name ?? '');
});

test('sign out returns to the guest', async ({ page }) => {
  user = await createTestUser();
  const handle = uniqueHandle('out');
  await finishOnboarding(user.id, handle);
  await page.goto('/me');
  await signIn(page, user);
  await expect(page.getByTestId('me-handle')).toHaveText(`Signed in as @${handle}`);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.goto('/');
  await openCity(page);
  await expect(page.getByTestId('hud-account')).toHaveText('Sign in');
  await expect(page.getByTestId('hud-name')).toHaveText(/^You're Guest-\d{4}$/);
});

test('delete account removes the profile row', async ({ page }) => {
  user = await createTestUser();
  const handle = uniqueHandle('del');
  await finishOnboarding(user.id, handle);
  await page.goto('/me');
  await signIn(page, user);
  await expect(page.getByTestId('me-handle')).toHaveText(`Signed in as @${handle}`);

  await page.getByRole('button', { name: 'Delete my account…' }).click();
  const confirm = page.getByRole('button', { name: 'Delete my account', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Type your handle/).fill('someone_else');
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Type your handle/).fill(handle);
  await confirm.click();

  await expect(page).toHaveURL(/\/$/);
  expect(await profileRow(user.id)).toBeNull();
});
