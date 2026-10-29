import { exports } from 'cloudflare:workers';
import { ApiError, DeleteAccountResponse } from '@shipfair/shared';
import { beforeEach, describe, expect, it } from 'vitest';

// Supabase is the stub in test/supabase-stub.mjs: `owner-token` is the booth owner (`maker1`),
// `ghost-token` a user with no profile row.
const stub = (path: string, init?: RequestInit) => fetch(`http://supabase.test${path}`, init);
const deleted = async () => (await (await stub('/__deleted')).json()) as string[];
const owner = '00000000-0000-4000-8000-000000000001';

const del = (body: unknown, token?: string) =>
  exports.default.fetch('https://web.test/api/me/delete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const errorCode = async (res: Response) => ApiError.parse(await res.json()).error.code;

describe('POST /api/me/delete', () => {
  beforeEach(async () => {
    await stub('/__mode', { method: 'POST', body: 'ok' });
  });

  it('deletes the account when the handle matches', async () => {
    const res = await del({ handle: 'maker1' }, 'owner-token');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(DeleteAccountResponse.parse(await res.json())).toEqual({ ok: true, queuedMedia: 2 });
    expect(await deleted()).toEqual([owner]);
  });

  it('takes handles as stored (lowercase)', async () => {
    const res = await del({ handle: 'MAKER1' }, 'owner-token');
    expect(await errorCode(res)).toBe('bad_request');
    expect(await deleted()).toEqual([]);
  });

  it('needs a valid session', async () => {
    const missing = await del({ handle: 'maker1' });
    expect(missing.status).toBe(401);
    expect(await errorCode(missing)).toBe('unauthorized');
    const bad = await del({ handle: 'maker1' }, 'forged-token');
    expect(bad.status).toBe(401);
    expect(await deleted()).toEqual([]);
  });

  it('refuses a handle that is not yours', async () => {
    const res = await del({ handle: 'someone_else' }, 'owner-token');
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('handle_mismatch');
    expect(await deleted()).toEqual([]);
  });

  it('validates the body', async () => {
    for (const body of ['not json', {}, { handle: 'no spaces allowed' }]) {
      const res = await del(body, 'owner-token');
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('bad_request');
    }
    expect(await deleted()).toEqual([]);
  });

  it('answers 404 when the profile is already gone', async () => {
    const res = await del({ handle: 'maker1' }, 'ghost-token');
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('not_found');
  });

  it('answers 503 when Supabase is down', async () => {
    await stub('/__mode', { method: 'POST', body: 'fail' });
    const res = await del({ handle: 'maker1' }, 'owner-token');
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('unavailable');
  });
});
