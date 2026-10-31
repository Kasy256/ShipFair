import { WorkerEntrypoint } from 'cloudflare:workers';
import { fakeWorld } from '@shipfair/shared/fake-world';

// The web Worker's RPC surface for load tests: any signed-in bot has a profile and no ban, the
// city is a fixed fake world, and stats batches are counted, not stored.

/** Same seed and size as bot.ts, so bots walk the city the shards validate against. */
const WORLD = fakeWorld(60, 7);

export class WebRpc extends WorkerEntrypoint {
  ping(): string {
    return 'pong from loadtest web stub';
  }

  getPlayer(userId: string, withProfile = true) {
    const tag = userId.slice(-6);
    return {
      profile: withProfile
        ? {
            id: userId,
            handle: `bot_${tag}`,
            displayName: `Bot ${tag}`,
            avatarStyle: {},
            createdAt: '2026-01-01T00:00:00+00:00',
          }
        : null,
      banned: false,
    };
  }

  ingestStats(batch: { rows: unknown[] }) {
    console.log(JSON.stringify({ event: 'ingest', rows: batch.rows.length }));
    return { ok: true, written: batch.rows.length };
  }

  world() {
    return WORLD;
  }

  flags() {
    return {
      MIN_ACCOUNT_AGE_MINUTES: 0,
      GUEST_CHAT: false,
      NEW_ACCOUNT_CHAT_MINUTES: 0,
      SUBMISSIONS_OPEN: true,
    };
  }
}

// biome-ignore lint/style/noDefaultExport: a Worker module's handler must be the default export.
export default { fetch: () => new Response('loadtest web stub', { status: 404 }) };
