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

/** The chunks every city visit needs at once; Rapier is the largest and on the critical path. */
const BOOT_CHUNK = /^assets\/(rapier|three|src)-[\w-]+\.js$/;
/** Rapier's WASM, emitted by rapierWasm(). */
const RAPIER_WASM = /^assets\/rapier-[\w-]+\.wasm$/;
/** In the compat build, `init()` hands the inlined base64 WASM to wasm-bindgen's loader. */
const RAPIER_INLINE = /\w+\.toByteArray\("([A-Za-z0-9+/=]{100000,})"\)\.buffer/g;
const WASM_MAGIC = '0061736d';

/**
 * Rapier's `-compat` build inlines its WASM as base64 inside the JS (1.6 MB gzipped, decoded on
 * the main thread). In production builds this takes the bytes out as a hashed
 * `assets/rapier-<hash>.wasm` (~1.19 MB gzipped, −26 %) and hands wasm-bindgen's loader a promise
 * of its bytes. Not the URL: with a URL the loader uses `instantiateStreaming`, and in the load
 * test (4× CPU, SwiftShader) streaming compilation competed with shader compilation for the CPU,
 * making "Enter" later than the base64 build. Fetched bytes were faster than both (prompt 14:
 * Fast 4G 5.9 s vs 6.9 s inline, Slow 4G 15.2 s vs 21.2 s, medians of 4). Development keeps the
 * inline copy. A Rapier upgrade that changes this shape fails the build rather than silently
 * shipping the base64 again.
 */
const rapierWasm = (): Plugin => ({
  name: 'shipfair:rapier-wasm',
  apply: 'build',
  transform(code, id) {
    if (!/[\\/]@dimforge[\\/]rapier3d-compat[\\/]dist[\\/]rapier\.mjs$/.test(id)) return null;
    const matches = [...code.matchAll(RAPIER_INLINE)];
    const base64 = matches[0]?.[1];
    if (matches.length !== 1 || !base64) {
      throw new Error(`rapier-wasm: expected one inline WASM in ${id}, found ${matches.length}`);
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.subarray(0, 4).toString('hex') !== WASM_MAGIC) {
      throw new Error('rapier-wasm: the inline data is not a WASM module');
    }
    const ref = this.emitFile({ type: 'asset', name: 'rapier.wasm', source: bytes });
    // A promise of bytes (wasm-bindgen awaits it), not the URL: see the note above on streaming.
    const bytesOf = `fetch(import.meta.ROLLUP_FILE_URL_${ref}).then((r) => r.arrayBuffer())`;
    return { code: code.replace(RAPIER_INLINE, bytesOf), map: null };
  },
});

/**
 * Modulepreloads the engine, three and Rapier chunks from index.html (prompt 14), so their
 * download starts with the shell instead of after it has been parsed (~1.1 s later on a 4×
 * slowed phone). Low priority, so the shell still paints first. Other pages fetch them too;
 * /submit and /me use the engine anyway, and the hashed files are cached for a year.
 */
const preloadBoot = (): Plugin => ({
  name: 'shipfair:preload-boot',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (_html, ctx) =>
      Object.keys(ctx.bundle ?? {})
        .filter((file) => BOOT_CHUNK.test(file) || RAPIER_WASM.test(file))
        .map((file) => ({
          tag: 'link',
          attrs: {
            // The WASM is a fetch() preload: Rapier's loader fetches it with the same mode.
            ...(RAPIER_WASM.test(file)
              ? { rel: 'preload', as: 'fetch', type: 'application/wasm' }
              : { rel: 'modulepreload' }),
            crossorigin: '',
            fetchpriority: 'low',
            href: `/${file}`,
          },
          injectTo: 'head' as const,
        })),
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    brandHtml(),
    staticHeaders(mode),
    rapierWasm(),
    preloadBoot(),
  ],
  // CI builds for deploys set SENTRY_SOURCEMAPS=1: maps are written next to the bundles without a
  // `sourceMappingURL` comment, uploaded to Sentry, then deleted before `wrangler deploy`, so
  // they are never served (.github/workflows/deploy-*.yml).
  build: { sourcemap: process.env.SENTRY_SOURCEMAPS ? 'hidden' : false },
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
                // KTX2Loader and its zstd decoder stay out: the engine imports them on demand.
                {
                  name: 'three',
                  test: /[\\/]three[\\/](build|src|examples[\\/]jsm[\\/](?!loaders[\\/]KTX2Loader|libs[\\/](zstddec|ktx-parse)|utils[\\/]WorkerPool))/,
                },
                // Everything the entry imports statically, in one chunk: otherwise every module
                // shared with a lazy page becomes its own tiny chunk (15 requests on a first load).
                { name: 'shell', tags: ['$initial'] },
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
