import { DeleteAccountRequest, type DeleteAccountResponse, WebWorkerEnv } from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';

// POST /api/me/delete (ARCHITECTURE.md §6). The caller proves who they are with their Supabase
// access token (checked by Supabase Auth itself, so a revoked session fails too) and types their
// handle to confirm. The service role then runs `delete_account`, which queues the booth media
// for R2 cleanup and deletes the auth user in one transaction; everything else cascades.

const ServiceEnv = WebWorkerEnv.pick({
  SUPABASE_URL: true,
  SUPABASE_ANON_KEY: true,
  SUPABASE_SERVICE_ROLE_KEY: true,
});
type ServiceEnv = z.infer<typeof ServiceEnv>;

const AuthUser = z.object({ id: z.uuid() });
const HandleRow = z.array(z.object({ handle: z.string() })).max(1);

const isJwt = (key: string) => key.split('.').length === 3;

/** Legacy keys are JWTs and also go in Authorization; new `sb_…` keys only in `apikey`. */
function keyHeaders(key: string): Record<string, string> {
  return isJwt(key) ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key };
}

function serviceEnv(env: Env): ServiceEnv {
  const parsed = ServiceEnv.safeParse(env);
  if (!parsed.success) {
    throw new AppError('unavailable', 503, 'Supabase service access is not configured', {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function call(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new AppError('unavailable', 503, 'Supabase is unreachable', { cause: error });
  }
}

/** The user behind a `Bearer` access token, according to Supabase Auth. */
export async function requireUser(env: Env, authorization: string | undefined): Promise<string> {
  const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new AppError('unauthorized', 401, 'Sign in first');
  const { SUPABASE_URL: base, SUPABASE_ANON_KEY: anon } = serviceEnv(env);
  const res = await call(new URL('/auth/v1/user', base), {
    headers: { apikey: anon, authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new AppError('unauthorized', 401, 'Your session has expired; sign in again');
  }
  if (!res.ok) throw new AppError('unavailable', 503, `Supabase Auth answered ${res.status}`);
  const user = AuthUser.safeParse(await res.json());
  if (!user.success) throw new AppError('unavailable', 503, 'Supabase Auth sent no user id');
  return user.data.id;
}

export async function deleteAccount(
  env: Env,
  userId: string,
  body: unknown,
): Promise<DeleteAccountResponse> {
  const request = DeleteAccountRequest.safeParse(body);
  if (!request.success) throw new AppError('bad_request', 400, 'Type your handle to confirm');
  const { SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: key } = serviceEnv(env);
  const headers = { ...keyHeaders(key), 'content-type': 'application/json' };

  const profileUrl = new URL('/rest/v1/profiles', base);
  profileUrl.searchParams.set('id', `eq.${userId}`);
  profileUrl.searchParams.set('select', 'handle');
  const profileRes = await call(profileUrl, { headers });
  if (!profileRes.ok) throw new AppError('unavailable', 503, 'Could not read the profile');
  const rows = HandleRow.safeParse(await profileRes.json());
  const handle = rows.success ? rows.data[0]?.handle : undefined;
  if (!handle) throw new AppError('not_found', 404, 'This account no longer exists');
  if (handle.toLowerCase() !== request.data.handle.toLowerCase()) {
    throw new AppError('handle_mismatch', 400, "That isn't your handle");
  }

  const rpc = await call(new URL('/rest/v1/rpc/delete_account', base), {
    method: 'POST',
    headers,
    body: JSON.stringify({ uid: userId }),
  });
  if (!rpc.ok) throw new AppError('unavailable', 503, `delete_account failed (${rpc.status})`);
  const queued = z
    .int()
    .nonnegative()
    .safeParse(await rpc.json());
  return { ok: true, queuedMedia: queued.success ? queued.data : 0 };
}
