import { FeatureFlags, FLAG_CACHE_S } from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from './env.ts';
import { serviceDb } from './service.ts';

// Feature flags (table `flags`, edited in /admin). Each isolate keeps them for FLAG_CACHE_S, so
// an edit reaches every isolate within 30 s; the isolate that saved it forgets its copy at once.

const FlagRows = z.array(z.object({ key: z.string(), value: z.unknown() }));

let cached: { flags: FeatureFlags; readAtMs: number } | null = null;

export async function readFlags(env: Env, nowMs = Date.now()): Promise<FeatureFlags> {
  if (cached && nowMs - cached.readAtMs < FLAG_CACHE_S * 1000) return cached.flags;
  const rows = FlagRows.parse(await serviceDb(env).select('flags', {}, 'key,value'));
  // Unknown keys are dropped and bad values fall back to their defaults (FeatureFlags).
  const flags = FeatureFlags.parse(Object.fromEntries(rows.map((row) => [row.key, row.value])));
  cached = { flags, readAtMs: nowMs };
  return flags;
}

/** After an edit, and in tests. */
export function forgetFlags(): void {
  cached = null;
}
