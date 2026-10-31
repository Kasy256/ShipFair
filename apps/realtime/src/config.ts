import { AOI_RADIUS_M, CHAT_RADIUS_M, MAX_PLAYERS_PER_SHARD, RealtimeEnv } from '@shipfair/shared';
import type { Env } from './env.ts';

// The realtime Worker's validated vars (RealtimeEnv). Tunables live in limits.ts.

export interface Limits {
  readonly maxPlayers: number;
  readonly aoiRadiusM: number;
  readonly chatRadiusM: number;
}

export interface Config {
  readonly jwksUrl: string;
  readonly statsSecret: string;
  readonly isManualTick: boolean;
  readonly limits: Limits;
}

const parsed = new WeakMap<Env, Config>();

/** Validated config for this env object, parsed once. Throws with the zod message if invalid. */
export function readConfig(env: Env): Config {
  const cached = parsed.get(env);
  if (cached) return cached;
  const vars = RealtimeEnv.parse(env);
  const config: Config = {
    jwksUrl: vars.SUPABASE_JWKS_URL,
    statsSecret: vars.STATS_INGEST_SECRET,
    isManualTick: vars.TICK_MODE === 'manual',
    limits: {
      maxPlayers: vars.MAX_PLAYERS_PER_SHARD ?? MAX_PLAYERS_PER_SHARD,
      aoiRadiusM: vars.AOI_RADIUS_M ?? AOI_RADIUS_M,
      chatRadiusM: vars.CHAT_RADIUS_M ?? CHAT_RADIUS_M,
    },
  };
  parsed.set(env, config);
  return config;
}
