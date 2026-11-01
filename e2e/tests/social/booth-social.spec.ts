import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  adminCall,
  deleteStaff,
  newStaff,
  type SeededBooth,
  type Staff,
  seedBooth,
} from '../admin/admin-helpers.ts';
import {
  createTestUser,
  deleteTestUser,
  finishOnboarding,
  localSupabase,
  serviceHeaders,
  signIn,
  type TestUser,
  uniqueHandle,
} from '../auth/auth-helpers.ts';
import { enterWorld } from '../engine/helpers.ts';
import { loadCity } from '../shell/shell-helpers.ts';

// Prompt 12: the booth panel's guestbook and upvotes against local Supabase (no realtime). A
// booth is seeded and approved through the admin API, which bumps the world version so the
// city has it. Visitors V and W sign the guestbook and vote; the owner O hides an entry.

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

let staff: Staff;
let owner: TestUser;
let visitor: TestUser;
let other: TestUser;
let booth: SeededBooth;
const pages: Page[] = [];

/** Opens the booth's share link signed in as `user`; resolves with the open booth panel. */
async function openBooth(browser: Browser, user: TestUser) {
  const page = await (await browser.newContext()).newPage();
  pages.push(page);
  await loadCity(page, `/b/${booth.slug}`);
  await signIn(page, user);
  await enterWorld(page);
  const panel = page.getByRole('dialog', { name: booth.name });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return { page, panel };
}

async function entryRow(body: string): Promise<{ id: number; body: string; hidden: boolean }> {
  const res = await fetch(
    `${localSupabase().url}/rest/v1/guestbook_entries?booth_id=eq.${booth.id}&select=id,body,hidden&order=id.desc&limit=1`,
    { headers: serviceHeaders() },
  );
  const rows = (await res.json()) as { id: number; body: string; hidden: boolean }[];
  const row = rows[0];
  if (!row) throw new Error(`no guestbook entry for "${body}"`);
  return row;
}

test.beforeAll(async ({ request }) => {
  staff = await newStaff();
  owner = await createTestUser();
  visitor = await createTestUser();
  other = await createTestUser();
  await finishOnboarding(owner.id, uniqueHandle('gb_owner'));
  await finishOnboarding(visitor.id, uniqueHandle('gb_visit'));
  await finishOnboarding(other.id, uniqueHandle('gb_other'));
  booth = await seedBooth(owner.id);
  await adminCall(request, staff, 'POST', `/api/admin/booths/${booth.id}/approve`, {});
  // The approval bumps the world version; wait until /api/world serves the new booth.
  await expect
    .poll(
      async () => {
        const res = await request.get('/api/world');
        const world = (await res.json()) as { booths: { id: string }[] };
        return world.booths.some((b) => b.id === booth.id);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
});

test.afterAll(async () => {
  for (const page of pages) await page.context().close();
  for (const user of [owner, visitor, other]) if (user) await deleteTestUser(user.id);
  await deleteStaff(staff);
});

test('a guestbook entry is filtered by the database, and the owner hides it', async ({
  browser,
}) => {
  const { page, panel } = await openBooth(browser, visitor);
  const input = panel.getByTestId('guestbook-input');
  await input.fill('this is fucking great');
  await expect(panel.getByText('21/200')).toBeVisible();
  await panel.getByTestId('guestbook-post').click();
  const entry = panel.getByTestId('guestbook-entry').first();
  await expect(entry.getByTestId('guestbook-body')).toHaveText('this is ★★★★★★★ great');
  expect((await entryRow('this is')).body).toBe('this is ★★★★★★★ great');
  // Only the owner gets "Hide".
  await expect(entry.getByTestId('guestbook-hide')).toHaveCount(0);

  const owned = await openBooth(browser, owner);
  const ownerEntry = owned.panel.getByTestId('guestbook-entry').filter({ hasText: 'great' });
  await ownerEntry.getByTestId('guestbook-hide').click();
  await expect(owned.panel.getByTestId('guestbook-entry').filter({ hasText: 'great' })).toHaveCount(
    0,
  );
  expect((await entryRow('this is')).hidden).toBe(true);

  // The visitor no longer sees it after a refetch.
  await page.reload();
  await page.waitForFunction(() => window.__shipfair !== undefined);
  await enterWorld(page);
  const again = page.getByRole('dialog', { name: booth.name });
  await expect(again).toBeVisible({ timeout: 15_000 });
  await expect(again.getByText('No entries yet. Be the first to say hi.')).toBeVisible();
});

test('upvotes toggle, and another context sees the new count after a refetch', async ({
  browser,
}) => {
  const v = await openBooth(browser, visitor);
  const vote = v.panel.getByTestId('vote-button');
  await expect(v.panel.getByTestId('vote-count')).toHaveText('0');
  await vote.click();
  await expect(vote).toHaveAttribute('aria-pressed', 'true');
  await expect(v.panel.getByTestId('vote-count')).toHaveText('1');
  // The heart burst plays in the world.
  await expect
    .poll(() =>
      v.page.evaluate(() => {
        window.__shipfair?.step(1 / 60, 3);
        return window.__shipfair?.net.hearts ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  const w = await openBooth(browser, other);
  await expect(w.panel.getByTestId('vote-count')).toHaveText('1');
  await w.panel.getByTestId('vote-button').click();
  await expect(w.panel.getByTestId('vote-count')).toHaveText('2');

  // V refetches (reopening the city) and sees W's vote; then takes their own vote back.
  await v.page.reload();
  await v.page.waitForFunction(() => window.__shipfair !== undefined);
  await enterWorld(v.page);
  const reopened = v.page.getByRole('dialog', { name: booth.name });
  await expect(reopened.getByTestId('vote-count')).toHaveText('2', { timeout: 15_000 });
  await reopened.getByTestId('vote-button').click();
  await expect(reopened.getByTestId('vote-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(reopened.getByTestId('vote-count')).toHaveText('1');
});
