import { WorkerEntrypoint } from 'cloudflare:workers';
import { routePartykitRequest } from 'partyserver';
import type { Env } from './env.ts';

export { Coordinator } from './coordinator.ts';
export { WorldShard } from './world-shard.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuids = (values: unknown): string[] =>
  Array.isArray(values)
    ? values.filter((v): v is string => typeof v === 'string' && UUID.test(v))
    : [];

/** RPC methods the web Worker calls over its service binding (never routable from the internet). */
export class RealtimeRpc extends WorkerEntrypoint<Env> {
  ping(): string {
    return 'pong from realtime';
  }

  /**
   * Booths changed (approved, edited, hidden): shards tell their players to refetch them.
   * Prompt 09 stub: logs and returns how many ids it accepted; prompt 10 broadcasts.
   */
  worldUpdate(boothIds: readonly string[]): number {
    const ids = uuids(boothIds);
    console.log(`worldUpdate: ${ids.length} booth(s)`, ids);
    return ids.length;
  }

  /**
   * Closes a banned user's sockets (TRUST_AND_SAFETY.md "Bans take effect immediately").
   * Prompt 09 stub: logs and reports whether the id was valid; prompt 10 closes the sockets.
   */
  kick(userId: string, code: string): boolean {
    const [id] = uuids([userId]);
    if (!id) return false;
    console.log(`kick: ${id} (${code})`);
    return true;
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
