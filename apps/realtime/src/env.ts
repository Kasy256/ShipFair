import type { FeatureFlags, PlayerRecord, WorldSnapshot } from '@shipfair/shared';
import type { IngestResult } from './stats.ts';

/** RPC surface of the web Worker's `WebRpc` entrypoint, as seen from realtime. */
export interface WebRpc {
  ping(): Promise<string>;
  /** Profile (skipped when `withProfile` is false) and live ban status; null for a bad id. */
  getPlayer(userId: string, withProfile?: boolean): Promise<PlayerRecord | null>;
  /** A batch of visit counts (`StatsBatch`), at most once a minute per shard. */
  ingestStats(batch: unknown): Promise<IngestResult>;
  /** The `/api/world` snapshot (edge-cached), or null when it can't be read. */
  world(): Promise<WorldSnapshot | null>;
  flags(): Promise<FeatureFlags>;
}

export interface Env {
  Coordinator: DurableObjectNamespace<import('./coordinator.ts').Coordinator>;
  WorldShard: DurableObjectNamespace<import('./world-shard.ts').WorldShard>;
  WEB: Fetcher & WebRpc;
  ENVIRONMENT: 'development' | 'staging' | 'production';
  // Validated with `RealtimeEnv` (config.ts); kept loose here so a bad value is a clear error.
  SUPABASE_JWKS_URL?: string;
  STATS_INGEST_SECRET?: string;
  MAX_PLAYERS_PER_SHARD?: string;
  AOI_RADIUS_M?: string;
  CHAT_RADIUS_M?: string;
  TICK_MODE?: string;
}
