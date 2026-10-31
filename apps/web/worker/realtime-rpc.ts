import { PlayerRecord, StatsBatch, Uuid, type WorldSnapshot } from '@shipfair/shared';
import type { Env } from './env.ts';
import { serviceDb } from './service.ts';
import { worldOrNull } from './world.ts';

// What `WebRpc` does for the realtime Worker (ARCHITECTURE.md §6). Arguments cross a Worker
// boundary, so they are parsed like any other input even though only our own Worker can call.

/** Cache key origin for the world snapshot RPC; the Cache API needs a URL, not a real host. */
const RPC_WORLD_ORIGIN = 'https://web.internal';

/**
 * Profile (unless `withProfile` is false) and live ban status for one user. Null for a malformed
 * id; an unreachable database throws, and the shard refuses the sign-in rather than guessing.
 */
export async function getPlayer(
  env: Env,
  userId: unknown,
  withProfile: unknown = true,
): Promise<PlayerRecord | null> {
  const uid = Uuid.safeParse(userId);
  if (!uid.success) return null;
  const raw = await serviceDb(env).rpc('realtime_player', {
    uid: uid.data,
    with_profile: withProfile !== false,
  });
  return PlayerRecord.parse(raw);
}

/** Constant-time string compare, so the secret can't be guessed a byte at a time. */
function sameSecret(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export type IngestResult =
  | { ok: true; written: number }
  | { ok: false; error: 'invalid' | 'forbidden' | 'unconfigured' };

/** Adds a shard's visit counts to `booth_stats_daily` in one SQL call (`ingest_booth_stats`). */
export async function ingestStats(env: Env, batch: unknown): Promise<IngestResult> {
  const expected = env.STATS_INGEST_SECRET;
  if (!expected) return { ok: false, error: 'unconfigured' };
  const parsed = StatsBatch.safeParse(batch);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  if (!sameSecret(parsed.data.secret, expected)) return { ok: false, error: 'forbidden' };
  if (parsed.data.rows.length === 0) return { ok: true, written: 0 };
  const written = await serviceDb(env).rpc('ingest_booth_stats', { stats: parsed.data.rows });
  return { ok: true, written: typeof written === 'number' ? written : 0 };
}

/** The `/api/world` snapshot through the same edge cache, or null when it can't be read. */
export function worldForRealtime(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<WorldSnapshot | null> {
  return worldOrNull(env, ctx, RPC_WORLD_ORIGIN);
}
