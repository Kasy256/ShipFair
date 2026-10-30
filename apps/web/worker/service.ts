import { WebWorkerEnv } from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';

// Service-role access to Supabase (Auth and PostgREST) with plain fetch, no supabase-js. Used by
// routes that need trust the browser doesn't have: account deletion, submissions, revisions.

const ServiceEnv = WebWorkerEnv.pick({
  SUPABASE_URL: true,
  SUPABASE_ANON_KEY: true,
  SUPABASE_SERVICE_ROLE_KEY: true,
});
type ServiceEnv = z.infer<typeof ServiceEnv>;

const AuthUser = z.object({ id: z.uuid() });

const isJwt = (key: string) => key.split('.').length === 3;

/** Legacy keys are JWTs and also go in Authorization; new `sb_…` keys only in `apikey`. */
function keyHeaders(key: string): Record<string, string> {
  return isJwt(key) ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key };
}

export function serviceEnv(env: Env): ServiceEnv {
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

/** PostgREST filters, e.g. `{ id: 'eq.<uuid>', status: 'in.(draft,rejected)' }`. */
export type Filters = Readonly<Record<string, string>>;

function restUrl(base: string, path: string, filters: Filters, select?: string): URL {
  const url = new URL(`/rest/v1/${path}`, base);
  for (const [column, filter] of Object.entries(filters)) url.searchParams.set(column, filter);
  if (select) url.searchParams.set('select', select);
  return url;
}

async function rows(res: Response, what: string): Promise<unknown[]> {
  if (!res.ok) throw new AppError('unavailable', 503, `${what} failed (${res.status})`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new AppError('unavailable', 503, `${what} sent a non-array`);
  return body;
}

/** A service-role PostgREST client for one request. Every method returns the affected rows. */
export function serviceDb(env: Env) {
  const { SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: key } = serviceEnv(env);
  const headers = { ...keyHeaders(key), 'content-type': 'application/json' };
  const write = { ...headers, prefer: 'return=representation' };
  return {
    async select(table: string, filters: Filters, select = '*'): Promise<unknown[]> {
      return rows(await call(restUrl(base, table, filters, select), { headers }), `read ${table}`);
    },
    async insert(table: string, values: Record<string, unknown>): Promise<unknown[]> {
      const res = await call(restUrl(base, table, {}), {
        method: 'POST',
        headers: write,
        body: JSON.stringify(values),
      });
      return rows(res, `insert into ${table}`);
    },
    async update(
      table: string,
      filters: Filters,
      values: Record<string, unknown>,
    ): Promise<unknown[]> {
      const res = await call(restUrl(base, table, filters), {
        method: 'PATCH',
        headers: write,
        body: JSON.stringify(values),
      });
      return rows(res, `update ${table}`);
    },
    async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
      const res = await call(restUrl(base, `rpc/${name}`, {}), {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new AppError('unavailable', 503, `${name} failed (${res.status})`);
      return res.json();
    },
  };
}
export type ServiceDb = ReturnType<typeof serviceDb>;
