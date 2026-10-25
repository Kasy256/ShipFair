import { WorkerEntrypoint } from 'cloudflare:workers';
import { routePartykitRequest } from 'partyserver';
import type { Env } from './env.ts';

export { Coordinator } from './coordinator.ts';
export { WorldShard } from './world-shard.ts';

/** RPC methods the web Worker calls over its service binding (never routable from the internet). */
export class RealtimeRpc extends WorkerEntrypoint<Env> {
  ping(): string {
    return 'pong from realtime';
  }
}

const notFound = () =>
  Response.json({ error: { code: 'not_found', message: 'Route not found' } }, { status: 404 });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/health') return Response.json({ ok: true });

    // Local proof that realtime → web RPC works through the dev registry. Hidden outside development.
    if (pathname === '/dev/ping-web') {
      if (env.ENVIRONMENT !== 'development') return notFound();
      return Response.json({ ok: true, reply: await env.WEB.ping() });
    }

    return (await routePartykitRequest(request, env)) ?? notFound();
  },
} satisfies ExportedHandler<Env>;
