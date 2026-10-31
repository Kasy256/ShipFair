import { WorkerEntrypoint } from 'cloudflare:workers';
import type { FeatureFlags, PlayerRecord, WorldSnapshot } from '@shipfair/shared';
import { app } from './app.ts';
import type { Env } from './env.ts';
import { readFlags } from './flags.ts';
import { getPlayer, type IngestResult, ingestStats, worldForRealtime } from './realtime-rpc.ts';
import { bumpWorldVersion } from './world.ts';

/** RPC methods other Workers call over a service binding (never routable from the internet). */
export class WebRpc extends WorkerEntrypoint<Env> {
  ping(): string {
    return 'pong from web';
  }

  /**
   * Bumps the world cache version so the next `/api/world` reads Postgres (approvals, tier
   * changes; ARCHITECTURE.md §6). Returns the new version.
   */
  purgeWorld(): Promise<number> {
    return bumpWorldVersion(this.env.KV);
  }

  /** Feature flags (cached 30 s), e.g. `GUEST_CHAT` and `NEW_ACCOUNT_CHAT_MINUTES` for chat. */
  flags(): Promise<FeatureFlags> {
    return readFlags(this.env);
  }

  /** Profile and ban status for a shard's `hello`. Ban status is read fresh every time. */
  getPlayer(userId: string, withProfile = true): Promise<PlayerRecord | null> {
    return getPlayer(this.env, userId, withProfile);
  }

  /** A shard's batched visit counts (every 60 s), checked against `STATS_INGEST_SECRET`. */
  ingestStats(batch: unknown): Promise<IngestResult> {
    return ingestStats(this.env, batch);
  }

  /** The world snapshot shards validate teleports and visits against (same cache as `/api/world`). */
  world(): Promise<WorldSnapshot | null> {
    return worldForRealtime(this.env, this.ctx);
  }
}

// Only /api/* and /b/* reach the Worker (`run_worker_first`). Everything else is served from
// static assets, and unknown paths fall back to index.html.
export default app;
