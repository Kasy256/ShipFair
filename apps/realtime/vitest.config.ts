import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { vitestPreset } from '@shipfair/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';
import { JWKS_URL, STATS_SECRET, TEST_JWK, USERS, WORLD } from './src/test/fixtures.ts';

const { d: _private, ...publicJwk } = TEST_JWK;

// Stands in for the web Worker so the WEB service binding resolves inside the pool. It knows the
// fixture users and world, and records `ingestStats` calls; tests read (and clear) them with
// GET /__calls and set the chat-age flag with POST /__flags, both through the binding.
const webStub = `
  import { WorkerEntrypoint } from 'cloudflare:workers';
  const USERS = ${JSON.stringify(USERS)};
  const WORLD = ${JSON.stringify(WORLD)};
  const OLD = '2026-01-01T00:00:00+00:00';
  let calls = [];
  let chatMinutes = 0;
  const profile = (id, handle, createdAt = OLD) =>
    ({ id, handle, displayName: handle[0].toUpperCase() + handle.slice(1), avatarStyle: { v: 2 }, createdAt });
  export class WebRpc extends WorkerEntrypoint {
    ping() { return 'pong from web stub'; }
    getPlayer(userId, withProfile = true) {
      calls.push(['getPlayer', userId, withProfile]);
      const known = {
        [USERS.ada]: profile(USERS.ada, 'ada'),
        [USERS.bob]: profile(USERS.bob, 'bob'),
        [USERS.banned]: profile(USERS.banned, 'troll'),
        [USERS.newbie]: profile(USERS.newbie, 'newbie', new Date().toISOString()),
      };
      return {
        profile: withProfile ? known[userId] ?? null : null,
        banned: userId === USERS.banned,
      };
    }
    ingestStats(batch) {
      calls.push(['ingestStats', batch]);
      if (batch.secret !== ${JSON.stringify(STATS_SECRET)}) return { ok: false, error: 'forbidden' };
      return { ok: true, written: batch.rows.length };
    }
    world() { return WORLD; }
    flags() {
      return { MIN_ACCOUNT_AGE_MINUTES: 0, GUEST_CHAT: false, NEW_ACCOUNT_CHAT_MINUTES: chatMinutes, SUBMISSIONS_OPEN: true };
    }
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/__calls') { const answer = Response.json(calls); calls = []; return answer; }
      if (pathname === '/__flags') { chatMinutes = Number(await request.text()); return new Response('ok'); }
      return new Response(null, { status: 404 });
    }
  }
  export default { fetch: () => new Response(null, { status: 404 }) };
`;

// Every outbound fetch of the realtime Worker lands here: it publishes the test key as JWKS.
const authStub = `
  const JWKS = ${JSON.stringify({ keys: [publicJwk] })};
  export default {
    fetch(request) {
      const url = new URL(request.url);
      if (url.href === ${JSON.stringify(JWKS_URL)}) return Response.json(JWKS);
      return new Response('not found', { status: 404 });
    },
  };
`;

// Worker tests run inside workerd with the bindings from wrangler.jsonc.
export default mergeConfig(
  vitestPreset,
  defineConfig({
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            SUPABASE_JWKS_URL: JWKS_URL,
            STATS_INGEST_SECRET: STATS_SECRET,
            // Small, so capacity and overflow tests need only a few sockets.
            MAX_PLAYERS_PER_SHARD: '4',
            // Tests step the shard loop themselves (`shard.tick()`), never on a real timer.
            TICK_MODE: 'manual',
          },
          outboundService: 'auth-stub',
          workers: [
            {
              name: 'shipfair-web',
              modules: true,
              script: webStub,
              compatibilityDate: '2026-08-15',
            },
            {
              name: 'auth-stub',
              modules: true,
              script: authStub,
              compatibilityDate: '2026-08-15',
            },
          ],
        },
      }),
    ],
    test: {
      // The first request in each file pays workerd cold start, which stacks up in parallel.
      testTimeout: 30_000,
      hookTimeout: 30_000,
      // obscenity (via @shipfair/shared) is CommonJS; workerd needs it pre-bundled as ESM.
      deps: {
        optimizer: { ssr: { enabled: true, include: ['@shipfair/shared > obscenity'] } },
      },
    },
  }),
);
