import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { vitestPreset } from '@shipfair/config/vitest';
import { defineConfig } from 'vitest/config';

// Stands in for the realtime Worker so the REALTIME service binding resolves inside the pool.
const realtimeStub = `
  import { WorkerEntrypoint } from 'cloudflare:workers';
  export class RealtimeRpc extends WorkerEntrypoint { ping() { return 'pong from realtime stub'; } }
  export default { fetch: () => new Response(null, { status: 404 }) };
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
              workers: [
                {
                  name: 'shipfair-realtime',
                  modules: true,
                  script: realtimeStub,
                  compatibilityDate: '2026-08-15',
                },
              ],
            },
          }),
        ],
        test: { ...vitestPreset.test, name: 'worker', include: ['worker/**/*.test.ts'] },
      },
      // SPA modules (no Worker runtime needed) run in Node.
      { test: { ...vitestPreset.test, name: 'app', include: ['src/**/*.test.{ts,tsx}'] } },
    ],
  },
});
