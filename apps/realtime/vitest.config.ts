import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { vitestPreset } from '@shipfair/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

// Stands in for the web Worker so the WEB service binding resolves inside the pool.
const webStub = `
  import { WorkerEntrypoint } from 'cloudflare:workers';
  export class WebRpc extends WorkerEntrypoint { ping() { return 'pong from web stub'; } }
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
              name: 'shipfair-web',
              modules: true,
              script: webStub,
              compatibilityDate: '2026-08-15',
            },
          ],
        },
      }),
    ],
  }),
);
