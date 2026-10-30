import { expect, test } from '@playwright/test';
import {
  accessTokenFor,
  createTestUser,
  deleteTestUser,
  signIn,
  type TestUser,
} from '../auth/auth-helpers.ts';
import { report } from '../engine/helpers.ts';
import { newMaker } from '../submit/submit-helpers.ts';
import {
  adminCall,
  boothRow,
  currentCard,
  deleteReports,
  deleteStaff,
  fileReport,
  focusOwnCard,
  logRows,
  newStaff,
  type Staff,
  seedBooth,
} from './admin-helpers.ts';

// Prompt 09: /admin against local Supabase. Needs `pnpm dev` and `pnpm db:start`. Serial: the
// flags test pauses submissions for everyone for a moment, and the queue is shared.
test.describe.configure({ mode: 'serial' });

let staff: Staff | undefined;
let users: TestUser[] = [];

test.beforeAll(async () => {
  staff = await newStaff();
});

test.afterEach(async () => {
  for (const user of users) await deleteTestUser(user.id);
  users = [];
});

test.afterAll(async () => {
  await deleteStaff(staff);
});

function theStaff(): Staff {
  if (!staff) throw new Error('no staff user');
  return staff;
}

test('non-staff are sent home and never download the admin chunk', async ({ page }) => {
  const maker = await newMaker();
  users.push(maker);
  const adminModules: string[] = [];
  page.on('request', (req) => {
    if (/\/src\/admin\/|AdminApp/.test(req.url())) adminModules.push(req.url());
  });
  await page.goto('/me');
  await signIn(page, maker);
  await expect(page.getByTestId('me-handle')).toBeVisible({ timeout: 30_000 });
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  expect(adminModules).toEqual([]);

  const res = await page.request.get('/api/admin/queue', {
    headers: { authorization: `Bearer ${await accessTokenFor(maker)}` },
  });
  expect(res.status()).toBe(403);
});

test('staff approve 10 queued booths with the keyboard alone', async ({ page, context }) => {
  test.setTimeout(240_000);
  const maker = await newMaker();
  users.push(maker);
  const seeded = await Promise.all(Array.from({ length: 10 }, () => seedBooth(maker.id)));
  const ours = new Set(seeded.map((b) => b.id));
  const versionBefore = Number((await (await page.request.get('/api/world')).json()).version);

  await page.goto('/me');
  await signIn(page, theStaff());
  await page.goto('/admin');
  const first = await focusOwnCard(page, ours);

  // J/K move between cards; O opens where the link ended up, in a new tab.
  const [popup] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('o')]);
  expect(popup.url()).toContain('/landing');
  await popup.close();
  await page.bringToFront();
  await page.keyboard.press('j');
  await expect.poll(() => currentCard(page)).not.toBe(first);
  await page.keyboard.press('k');
  await expect.poll(() => currentCard(page)).toBe(first);

  const approved: string[] = [];
  const started = Date.now();
  while (approved.length < seeded.length) {
    const id = await focusOwnCard(page, ours);
    await page.keyboard.press('a');
    // An approval copies media, writes the DB and KV, and calls realtime: slow under parallel load.
    await expect(page.getByTestId('queue-status')).toContainText(
      seeded.find((b) => b.id === id)?.name ?? '',
      { timeout: 30_000 },
    );
    approved.push(id);
    ours.delete(id);
    if (ours.size > 0) await expect.poll(() => currentCard(page)).not.toBe(id);
  }
  const elapsedMs = Date.now() - started;
  report('keyboard approve 10 booths ms', elapsedMs);
  console.log(`METRIC admin queue :: 10 approvals by keyboard = ${elapsedMs} ms`);

  for (const booth of seeded) {
    expect(await boothRow(booth.id)).toMatchObject({ status: 'approved' });
    expect(await logRows(booth.id)).toContainEqual({
      action: 'approve',
      actor_id: theStaff().id,
      actor_handle: theStaff().handle,
    });
  }
  // Live within seconds: the cache version moved, and the next snapshot has them all.
  const world = await (await page.request.get('/api/world')).json();
  expect(Number(world.version)).toBeGreaterThanOrEqual(versionBefore + 10);
  const ids = new Set(world.booths.map((b: { id: string }) => b.id));
  for (const booth of seeded) expect(ids.has(booth.id)).toBe(true);

  // The log viewer and the user lookup show the same story.
  await page.goto('/admin?tab=log');
  await page.getByLabel('Action').selectOption('approve');
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page.getByTestId('log-row').filter({ hasText: seeded[0]?.id ?? '' })).toHaveCount(
    1,
    { timeout: 30_000 },
  );
  await page.goto(`/admin?tab=users&user=${maker.id}`);
  await expect(page.getByTestId('user-detail')).toContainText(`@${maker.handle}`);
  await expect(page.getByTestId('user-detail')).toContainText(seeded[0]?.name ?? '');
});

test("a rejection with a reason shows on the maker's /me", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const maker = await newMaker();
  users.push(maker);
  const booth = await seedBooth(maker.id);

  await page.goto('/me');
  await signIn(page, theStaff());
  await page.goto('/admin');
  await focusOwnCard(page, new Set([booth.id]));
  await page.keyboard.press('r');
  const picker = page.getByTestId('reject-picker');
  await expect(picker).toBeVisible();
  await page.keyboard.press('5'); // "Not enough detail yet"
  await picker.getByTestId('reject-note').fill('Add a screenshot of the product');
  await picker.getByTestId('reject-confirm').click();
  await expect(page.getByTestId('queue-status')).toContainText(`Rejected ${booth.name}`);
  expect(await boothRow(booth.id)).toMatchObject({
    status: 'rejected',
    reject_reason: 'Not enough detail yet: Add a screenshot of the product',
  });

  const makerContext = await browser.newContext();
  const makerPage = await makerContext.newPage();
  await makerPage.goto('/me');
  await signIn(makerPage, maker);
  const row = makerPage.getByTestId('my-booth').filter({ hasText: booth.name });
  await expect(row.getByTestId('status-chip')).toHaveText('Changes needed', { timeout: 30_000 });
  await expect(row.getByTestId('reject-reason')).toContainText(
    'Not enough detail yet: Add a screenshot of the product',
  );
  await makerContext.close();
});

test('3 reports auto-hide a booth, and it waits in the reports inbox', async ({ page }) => {
  test.setTimeout(180_000);
  const maker = await newMaker();
  const reporters = [await createTestUser(), await createTestUser(), await createTestUser()];
  users.push(maker, ...reporters);
  const booth = await seedBooth(maker.id, 'approved');

  for (const reporter of reporters.slice(0, 2)) await fileReport(reporter, booth.id);
  expect(await boothRow(booth.id)).toMatchObject({ status: 'approved' });
  await fileReport(reporters[2] as TestUser, booth.id);
  expect(await boothRow(booth.id)).toMatchObject({ status: 'hidden' });
  expect(await logRows(booth.id)).toContainEqual({
    action: 'auto_hide',
    actor_id: null,
    actor_handle: null,
  });

  await page.goto('/me');
  await signIn(page, theStaff());
  await page.goto('/admin?tab=reports');
  const group = page.locator(`[data-testid="report-group"][data-target-id="${booth.id}"]`);
  await expect(group).toBeVisible({ timeout: 30_000 });
  await expect(group.getByTestId('report-count')).toHaveText('3 open');
  await expect(group.getByTestId('status-chip')).toHaveText('Hidden');
  await expect(group).toContainText(booth.name);

  // Reviewed and fine: unhide it, then dismiss the reports.
  await group.getByRole('button', { name: 'Unhide' }).click();
  await expect(group.getByTestId('status-chip')).toHaveText('Live');
  await group.getByRole('button', { name: 'Dismiss' }).click();
  await expect(group).toHaveCount(0);
  expect(await boothRow(booth.id)).toMatchObject({ status: 'approved' });
  // Reports outlive their reporters (reporter_id is set null), so remove them explicitly.
  await deleteReports(booth.id);
});

test('turning SUBMISSIONS_OPEN off blocks submits with a friendly message', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const maker = await newMaker();
  users.push(maker);
  const draft = await seedBooth(maker.id, 'draft');
  try {
    await page.goto('/me');
    await signIn(page, theStaff());
    await page.goto('/admin?tab=flags');
    const toggle = page.getByTestId('flag-SUBMISSIONS_OPEN');
    await expect(toggle).toBeChecked({ timeout: 30_000 });
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText(`by @${theStaff().handle}`)).toBeVisible();

    const makerContext = await browser.newContext();
    const makerPage = await makerContext.newPage();
    await makerPage.goto('/submit');
    await signIn(makerPage, maker);
    await expect(makerPage.getByTestId('submissions-paused')).toBeVisible({ timeout: 30_000 });
    await makerContext.close();

    const res = await request.post(`/api/booths/${draft.id}/submit`, {
      headers: { authorization: `Bearer ${await accessTokenFor(maker)}` },
      data: { turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' },
    });
    expect(res.status()).toBe(503);
    expect((await res.json()).error.code).toBe('submissions_paused');
    expect(await boothRow(draft.id)).toMatchObject({ status: 'draft' });
  } finally {
    await adminCall(request, theStaff(), 'PUT', '/api/admin/flags', {
      key: 'SUBMISSIONS_OPEN',
      value: true,
    });
  }
});
