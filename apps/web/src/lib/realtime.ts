import { type BoothChange, ShardId, type WorldSnapshot } from '@shipfair/shared';

/** The realtime port `pnpm dev` runs on (apps/realtime `wrangler dev --port 1999`). */
const DEV_REALTIME_PORT = 1999;
/** `?with=w-2`: the "join a friend" link. */
export const FRIEND_PARAM = 'with';

/**
 * Where the realtime Worker is, or null for "don't connect" (the world is still explorable).
 * `VITE_REALTIME_HOST` in builds; in development `?realtime=host:port` overrides it (e2e runs its
 * own server) and `?realtime=off` stays solo, and without either it is this host on port 1999.
 */
export function realtimeHost(
  search: string,
  env: { configured: string | undefined; isDev: boolean; pageHostname: string },
): string | null {
  if (env.isDev) {
    const override = new URLSearchParams(search).get('realtime');
    if (override === 'off') return null;
    if (override && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(override)) return override;
  }
  if (env.configured) return env.configured;
  return env.isDev ? `${env.pageHostname}:${DEV_REALTIME_PORT}` : null;
}

/** The shard named by `?with=`, or null when absent or not a shard name. */
export function friendShard(search: string): string | null {
  const parsed = ShardId.safeParse(new URLSearchParams(search).get(FRIEND_PARAM));
  return parsed.success ? parsed.data : null;
}

/** This page's address with `?with=<shard>`, so a friend lands in the same shard. */
export function inviteUrl(href: string, shard: string): string {
  const url = new URL(href);
  url.searchParams.set(FRIEND_PARAM, shard);
  return url.toString();
}

/**
 * The changes `notice:world_update` announced: each id in the new snapshot is an upsert, each
 * id missing from it was taken down.
 */
export function boothChangesFor(next: WorldSnapshot, boothIds: readonly string[]): BoothChange[] {
  const byId = new Map(next.booths.map((b) => [b.id, b]));
  return boothIds.map((id): BoothChange => {
    const booth = byId.get(id);
    return booth ? { type: 'upsert', booth } : { type: 'remove', boothId: id };
  });
}
