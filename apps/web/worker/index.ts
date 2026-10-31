import { WorkerEntrypoint } from 'cloudflare:workers';
import type { FeatureFlags } from '@shipfair/shared';
import { app } from './app.ts';
import type { Env } from './env.ts';
import { readFlags } from './flags.ts';
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
}

// Only /api/* and /b/* reach the Worker (`run_worker_first`). Everything else is served from
// static assets, and unknown paths fall back to index.html.
export default app;
