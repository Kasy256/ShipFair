import pkg from '../package.json';
import type { Env } from './env.ts';
import { selectAnon } from './supabase.ts';

// `GET /api/health` for uptime monitors (INFRASTRUCTURE.md §8). One cheap anon read (a single
// district id, under RLS) proves the Worker can reach Postgres. Never cached.

export interface Health {
  ok: boolean;
  /** package.json version. */
  version: string;
  /** The git sha this Worker was deployed from (`RELEASE` var), `dev` locally. */
  release: string;
  environment: Env['ENVIRONMENT'];
  db: { ok: boolean; ms: number };
}

export async function health(env: Env): Promise<{ body: Health; status: 200 | 503 }> {
  const started = Date.now();
  let isDbOk = true;
  try {
    await selectAnon(env, 'districts?select=id&limit=1');
  } catch (error) {
    isDbOk = false;
    console.error('health: database check failed', error);
  }
  const body: Health = {
    ok: isDbOk,
    version: pkg.version,
    release: env.RELEASE ?? 'dev',
    environment: env.ENVIRONMENT,
    db: { ok: isDbOk, ms: Date.now() - started },
  };
  return { body, status: isDbOk ? 200 : 503 };
}
