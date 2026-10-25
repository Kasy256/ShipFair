import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { vitestPreset } from '@shipfair/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

// Stands in for the realtime Worker so the REALTIME service binding resolves inside the pool.
const realtimeStub = `
  import { WorkerEntrypoint } from 'cloudflare:workers';
  export class RealtimeRpc extends WorkerEntrypoint { ping() { return 'pong from realtime stub'; } }
  export default { fetch: () => new Response(null, { status: 404 }) };
`;

// Worker tests run inside workerd with the bindings from wrangler.jsonc.
export default mergeConfig(
  vitestPreset,
  defineConfig({
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
    test: { include: ['worker/**/*.test.ts'] },
  }),
);
