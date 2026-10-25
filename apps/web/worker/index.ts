import { WorkerEntrypoint } from 'cloudflare:workers';
import { app } from './app.ts';
import type { Env } from './env.ts';

/** RPC methods the realtime Worker calls over its service binding (never routable from the internet). */
export class WebRpc extends WorkerEntrypoint<Env> {
  ping(): string {
    return 'pong from web';
  }
}

// Only /api/* reaches the Worker (`run_worker_first`). Everything else is served from static
// assets, and unknown paths fall back to index.html.
export default app;
