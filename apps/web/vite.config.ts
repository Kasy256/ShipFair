import { cloudflare } from '@cloudflare/vite-plugin';
import { APP_NAME, APP_TAGLINE } from '@shipfair/shared';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, searchForWorkspaceRoot } from 'vite';
import { headersFile } from './worker/security-headers.ts';

/** Fills `%APP_NAME%` and `%APP_TAGLINE%` in index.html so the brand only lives in brand.ts. */
const brandHtml = (): Plugin => ({
  name: 'shipfair:brand-html',
  transformIndexHtml: (html) =>
    html.replaceAll('%APP_NAME%', APP_NAME).replaceAll('%APP_TAGLINE%', APP_TAGLINE),
});

/**
 * Writes `_headers` into the client build: static assets skip the Worker, so this is how they
 * get the CSP and cache headers (worker/security-headers.ts has the values).
 */
const staticHeaders = (mode: string): Plugin => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    name: 'shipfair:static-headers',
    applyToEnvironment: (environment) => environment.name === 'client',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: headersFile({
          mediaHost: env.VITE_MEDIA_HOST,
          supabaseUrl: env.VITE_SUPABASE_URL,
          realtimeHost: env.VITE_REALTIME_HOST,
          isDev: false,
        }),
      });
    },
  };
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), cloudflare(), brandHtml(), staticHeaders(mode)],
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            // Named, separately cached engine chunks. Rapier's compat build inlines its WASM, so
            // load budgets count it on its own line (TECH_STACK.md, known constraints).
            codeSplitting: {
              groups: [
                { name: 'rapier', test: /[\\/]@dimforge[\\/]rapier3d-compat[\\/]/ },
                { name: 'three', test: /[\\/]three[\\/](build|examples|src)[\\/]/ },
              ],
            },
          },
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
      // Never serve the read-only prototype (or secrets) from the dev server.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/reference/**'],
    },
  },
}));
