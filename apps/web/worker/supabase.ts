import { WebWorkerEnv } from '@shipfair/shared';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';

// Public reads go straight to PostgREST with the anon key, so RLS decides what comes back: a
// policy mistake can't leak drafts into `/api/world`. No supabase-js needed for a few GETs.

const AnonEnv = WebWorkerEnv.pick({ SUPABASE_URL: true, SUPABASE_ANON_KEY: true });

const isJwt = (key: string) => key.split('.').length === 3;

/** `GET /rest/v1/<path>` as the anon role. Throws `world_unavailable` on any failure. */
export async function selectAnon(env: Env, path: string): Promise<unknown[]> {
  const parsed = AnonEnv.safeParse(env);
  if (!parsed.success) {
    throw new AppError('world_unavailable', 503, 'Supabase is not configured', {
      cause: parsed.error,
    });
  }
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: key } = parsed.data;
  // Legacy anon keys are JWTs and also go in Authorization; publishable keys only in `apikey`.
  const headers: Record<string, string> = { apikey: key, accept: 'application/json' };
  if (isJwt(key)) headers.authorization = `Bearer ${key}`;
  let response: Response;
  try {
    response = await fetch(new URL(`/rest/v1/${path}`, url), { headers });
  } catch (error) {
    throw new AppError('world_unavailable', 503, 'Supabase is unreachable', { cause: error });
  }
  if (!response.ok) {
    throw new AppError('world_unavailable', 503, `Supabase answered ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new AppError('world_unavailable', 503, 'Supabase returned a non-array body');
  }
  return body;
}
