import { WorkerEntrypoint } from 'cloudflare:workers';
import { ShardId } from '@shipfair/shared';
import { getServerByName, type Lobby, routePartykitRequest } from 'partyserver';
import type { Env } from './env.ts';
import type { WorldShard } from './world-shard.ts';

export { Coordinator } from './coordinator.ts';
export { WorldShard } from './world-shard.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuids = (values: unknown): string[] =>
  Array.isArray(values)
    ? values.filter((v): v is string => typeof v === 'string' && UUID.test(v))
    : [];

const coordinator = (env: Env) => getServerByName(env.Coordinator, 'main');

/** Calls `fn` on every live shard; one shard failing doesn't stop the others. */
async function eachShard(
  env: Env,
  fn: (shard: DurableObjectStub<WorldShard>) => Promise<unknown>,
): Promise<void> {
  const names = await (await coordinator(env)).liveShards();
  const results = await Promise.allSettled(
    names.map(async (name) => fn(await getServerByName(env.WorldShard, name))),
  );
  for (const r of results) {
    if (r.status === 'rejected') console.error('realtime: shard call failed', r.reason);
  }
}

/** RPC methods the web Worker calls over its service binding (never routable from the internet). */
export class RealtimeRpc extends WorkerEntrypoint<Env> {
  ping(): string {
    return 'pong from realtime';
  }

  /**
   * Booths changed (approved, edited, hidden): every live shard reloads the world and sends its
   * players `notice:world_update`. Returns how many valid booth ids were passed on.
   */
  async worldUpdate(boothIds: readonly string[]): Promise<number> {
    const ids = uuids(boothIds);
    if (ids.length === 0) return 0;
    await eachShard(this.env, (shard) => shard.worldUpdate(ids));
    return ids.length;
  }

  /**
   * Closes a user's sockets on every shard (TRUST_AND_SAFETY.md "Bans take effect immediately").
   * Returns whether the id was valid; the ban itself is also checked on every `hello`.
   */
  async kick(userId: string, code: string): Promise<boolean> {
    const [id] = uuids([userId]);
    if (!id) return false;
    await eachShard(this.env, (shard) => shard.kick(id, code === 'banned' ? 'banned' : 'kicked'));
    return true;
  }
}

const notFound = () =>
  Response.json({ error: { code: 'not_found', message: 'Route not found' } }, { status: 404 });

// Public surface: `GET /parties/coordinator/main/join` and WebSockets to `/parties/world-shard/w-<n>`.
// Everything else PartyServer would route (other names, other paths, sockets to the coordinator)
// is refused here, so nobody can create objects or call the coordinator in other ways.
const isJoin = (req: Request, lobby: Lobby<Env>) =>
  lobby.className === 'Coordinator' &&
  lobby.name === 'main' &&
  req.method === 'GET' &&
  new URL(req.url).pathname.endsWith('/main/join');

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // Shard list, populations and totals for uptime checks (clients get totals pushed instead).
    if (pathname === '/health') {
      return Response.json(await (await coordinator(env)).health(), {
        headers: { 'cache-control': 'no-store' },
      });
    }

    // Local proof that realtime → web RPC works through the dev registry. Hidden outside development.
    if (pathname === '/dev/ping-web') {
      if (env.ENVIRONMENT !== 'development') return notFound();
      return Response.json({ ok: true, reply: await env.WEB.ping() });
    }

    const routed = await routePartykitRequest(request, env, {
      cors: true,
      onBeforeConnect: (_req, lobby) =>
        lobby.className === 'WorldShard' && ShardId.safeParse(lobby.name).success
          ? undefined
          : notFound(),
      onBeforeRequest: (req, lobby) => (isJoin(req, lobby) ? undefined : notFound()),
    });
    return routed ?? notFound();
  },
} satisfies ExportedHandler<Env>;
