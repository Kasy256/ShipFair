import { readFileSync } from 'node:fs';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { vitestPreset } from '@shipfair/config/vitest';
import { APP_NAME, APP_TAGLINE } from '@shipfair/shared';
import { defineConfig } from 'vitest/config';

// Stands in for the realtime Worker so the REALTIME service binding resolves inside the pool.
const realtimeStub = `
  import { WorkerEntrypoint } from 'cloudflare:workers';
  export class RealtimeRpc extends WorkerEntrypoint { ping() { return 'pong from realtime stub'; } }
  export default { fetch: () => new Response(null, { status: 404 }) };
`;

// Serves the real index.html, branded like the Vite plugin does, as the static assets binding.
const indexHtml = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  .replaceAll('%APP_NAME%', APP_NAME)
  .replaceAll('%APP_TAGLINE%', APP_TAGLINE);
const assetsStub = `
  const html = ${JSON.stringify(indexHtml)};
  export default {
    fetch: (request) => new URL(request.url).pathname === '/'
      ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"index"' } })
      : new Response('not found', { status: 404 }),
  };
`;

// Each project restates `include` because mergeConfig would concatenate it with the preset's.
export default defineConfig({
  test: {
    projects: [
      // Worker tests run inside workerd with the bindings from wrangler.jsonc.
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: {
                SUPABASE_URL: 'https://supabase.test',
                SUPABASE_ANON_KEY: 'test-anon-key',
                SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
              },
              serviceBindings: { ASSETS: 'assets-stub' },
              // Every outbound fetch (the Supabase REST reads) goes to the stub.
              outboundService: 'supabase-stub',
              workers: [
                {
                  name: 'shipfair-realtime',
                  modules: true,
                  script: realtimeStub,
                  compatibilityDate: '2026-08-15',
                },
                {
                  name: 'supabase-stub',
                  modules: true,
                  scriptPath: './worker/test/supabase-stub.mjs',
                  compatibilityDate: '2026-08-15',
                },
                {
                  name: 'assets-stub',
                  modules: true,
                  script: assetsStub,
                  compatibilityDate: '2026-08-15',
                },
              ],
            },
          }),
        ],
        test: {
          ...vitestPreset.test,
          name: 'worker',
          include: ['worker/**/*.test.ts'],
          // Submission tests upload several objects through workerd each; 5 s is too tight on slow CI.
          testTimeout: 30_000,
          // The first request in each file pays workerd cold start, which stacks up in parallel.
          hookTimeout: 30_000,
          // obscenity (via @shipfair/shared) is CommonJS; workerd needs it pre-bundled as ESM.
          deps: {
            optimizer: { ssr: { enabled: true, include: ['@shipfair/shared > obscenity'] } },
          },
        },
      },
      // SPA modules (no Worker runtime needed) run in Node.
      { test: { ...vitestPreset.test, name: 'app', include: ['src/**/*.test.{ts,tsx}'] } },
    ],
  },
});
