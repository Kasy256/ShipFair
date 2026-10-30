import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import {
  accessTokenFor,
  createTestUser,
  deleteTestUser,
  finishOnboarding,
  localSupabase,
  serviceHeaders,
  type TestUser,
  uniqueHandle,
} from '../auth/auth-helpers.ts';

// Prompt 09 e2e: staff accounts, booths seeded straight into the queue, and admin API calls.
// Seeded booths skip the form (prompt 08 covers it), so a test can queue ten in a second.

export interface Staff extends TestUser {
  handle: string;
  token: string;
}

/** A signed-up user promoted to admin with the service role, plus an access token. */
export async function newStaff(): Promise<Staff> {
  const user = await createTestUser();
  const handle = uniqueHandle('staff');
  await finishOnboarding(user.id, handle);
  const res = await fetch(`${localSupabase().url}/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify({ role: 'admin' }),
  });
  expect(res.status).toBe(204);
  return { ...user, handle, token: await accessTokenFor(user) };
}

export const deleteStaff = (staff: Staff | undefined) =>
  staff ? deleteTestUser(staff.id) : Promise.resolve();

async function rest(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${localSupabase().url}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(), prefer: 'return=representation', ...init.headers },
  });
  expect(res.ok, await res.clone().text()).toBe(true);
  return res.status === 204 ? null : res.json();
}

export interface SeededBooth {
  id: string;
  slug: string;
  name: string;
}

/**
 * A booth inserted with the service role in `status` (default pending), with a clean pre-screen
 * log row so the queue sorts it among the clean ones. No media: approval has nothing to copy.
 */
export async function seedBooth(
  ownerId: string,
  status: 'pending' | 'approved' | 'draft' = 'pending',
): Promise<SeededBooth> {
  const slug = `e2e-admin-${randomUUID().slice(0, 8)}`;
  const name = `Admin ${slug.slice(-8)}`;
  const [row] = (await rest('booths', {
    method: 'POST',
    body: JSON.stringify({
      owner_id: ownerId,
      slug,
      name,
      tagline: 'A booth seeded for the admin tests',
      url: `https://example.com/${slug}`,
      district_id: 1,
      status,
      approved_at: status === 'approved' ? new Date().toISOString() : null,
    }),
  })) as { id: string }[];
  if (!row) throw new Error('booth insert returned nothing');
  if (status === 'pending') {
    await rest('moderation_log', {
      method: 'POST',
      body: JSON.stringify({
        action: 'prescreen',
        target_type: 'booth',
        target_id: row.id,
        detail: { score: 0, flags: [], finalUrl: `https://example.com/${slug}/landing` },
      }),
    });
  }
  return { id: row.id, slug, name };
}

export async function boothRow(id: string) {
  const [row] = (await rest(`booths?id=eq.${id}&select=status,reject_reason,approved_at`, {
    method: 'GET',
  })) as { status: string; reject_reason: string | null; approved_at: string | null }[];
  return row;
}

export async function logRows(targetId: string) {
  return (await rest(
    `moderation_log?target_id=eq.${targetId}&select=action,actor_id,actor_handle&order=id`,
    { method: 'GET' },
  )) as { action: string; actor_id: string | null; actor_handle: string | null }[];
}

/** A report from `user` with their own token, under RLS, as the app will file it. */
export async function fileReport(user: TestUser, boothId: string): Promise<void> {
  const { url, anonKey } = localSupabase();
  const res = await fetch(`${url}/rest/v1/reports`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${await accessTokenFor(user)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      reporter_id: user.id,
      target_type: 'booth',
      target_id: boothId,
      reason: 'spam',
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
}

/** Removes every report about a booth (the tests' own; local Supabase only). */
export async function deleteReports(boothId: string): Promise<void> {
  await rest(`reports?target_type=eq.booth&target_id=eq.${boothId}`, { method: 'DELETE' });
}

/** Calls an admin route as `staff`. */
export async function adminCall(
  request: APIRequestContext,
  staff: Staff,
  method: 'POST' | 'PUT',
  path: string,
  data: unknown,
): Promise<void> {
  const res = await request.fetch(path, {
    method,
    headers: { authorization: `Bearer ${staff.token}` },
    data,
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** The booth id on the queue card now showing. */
export const currentCard = (page: Page) =>
  page.getByTestId('queue-card').getAttribute('data-booth-id');

/**
 * Moves through the queue with J until one of `ids` is showing (other runs' booths may be
 * queued too) and returns it.
 */
export async function focusOwnCard(page: Page, ids: ReadonlySet<string>): Promise<string> {
  for (let step = 0; step < 50; step++) {
    await expect(page.getByTestId('queue-card')).toBeVisible({ timeout: 30_000 });
    const id = await currentCard(page);
    if (id && ids.has(id)) return id;
    await page.keyboard.press('j');
    await expect.poll(() => currentCard(page)).not.toBe(id);
  }
  throw new Error('none of the seeded booths reached the queue');
}
