import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

// Prompt 07 e2e: test users live in local Supabase only. They are created and inspected with the
// service role (from the files `pnpm db:start` writes) and signed in with the local-only email +
// password provider through `window.__shipfairAuth`. OAuth itself isn't exercised here.

function readVars(relative: string): Record<string, string> {
  const text = readFileSync(new URL(`../../../apps/web/${relative}`, import.meta.url), 'utf8');
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1] ?? '', m[2] ?? '']),
  );
}

interface Supabase {
  url: string;
  anonKey: string;
  serviceKey: string;
}

let cached: Supabase | undefined;

export function localSupabase(): Supabase {
  if (cached) return cached;
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey } =
    readVars('.env.development.local');
  const serviceKey = readVars('.dev.vars').SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error('Run `pnpm db:start` first (it writes the local keys)');
  }
  cached = { url, anonKey, serviceKey };
  return cached;
}

/** A Supabase access token for a test user (password grant, local only), for `/api` calls. */
export async function accessTokenFor(user: TestUser): Promise<string> {
  const { url, anonKey } = localSupabase();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

export function serviceHeaders(): Record<string, string> {
  const { serviceKey } = localSupabase();
  const headers: Record<string, string> = {
    apikey: serviceKey,
    'content-type': 'application/json',
  };
  if (serviceKey.split('.').length === 3) headers.authorization = `Bearer ${serviceKey}`;
  return headers;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** A confirmed email + password user; the signup trigger gives it a `maker_xxxxxx` profile. */
export async function createTestUser(): Promise<TestUser> {
  const email = `e2e-${randomUUID()}@shipfair.test`;
  const password = `pw-${randomUUID()}`;
  const res = await fetch(`${localSupabase().url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: 'E2E Maker' },
    }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  const { id } = (await res.json()) as { id: string };
  return { id, email, password };
}

/** Removes a test user if a test left it behind (deletion tests remove their own). */
export async function deleteTestUser(id: string): Promise<void> {
  await fetch(`${localSupabase().url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
  });
}

export interface ProfileRow {
  handle: string;
  display_name: string;
  avatar_style: { top?: { item?: string } };
  onboarded_at: string | null;
}

/** The profile row as the service role sees it (null when it doesn't exist). */
export async function profileRow(id: string): Promise<ProfileRow | null> {
  const res = await fetch(
    `${localSupabase().url}/rest/v1/profiles?id=eq.${id}&select=handle,display_name,avatar_style,onboarded_at`,
    { headers: serviceHeaders() },
  );
  expect(res.status).toBe(200);
  const rows = (await res.json()) as ProfileRow[];
  return rows[0] ?? null;
}

/** Skips onboarding for tests about something else. */
export async function finishOnboarding(id: string, handle: string): Promise<void> {
  const res = await fetch(`${localSupabase().url}/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify({ handle, onboarded_at: new Date().toISOString() }),
  });
  expect(res.status).toBe(204);
}

export const uniqueHandle = (prefix: string) =>
  `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;

/** Signs in on the open page with the test-only helper and waits for the session to apply. */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.waitForFunction(() => window.__shipfairAuth !== undefined);
  const error = await page.evaluate(
    ([email, password]) =>
      window.__shipfairAuth?.signInWithPassword(email, password) ?? 'no helper',
    [user.email, user.password] as const,
  );
  expect(error).toBeNull();
}
