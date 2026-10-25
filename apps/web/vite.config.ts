import { cloudflare } from '@cloudflare/vite-plugin';
import { APP_NAME } from '@shipfair/shared';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, searchForWorkspaceRoot } from 'vite';

/** Fills `%APP_NAME%` in index.html so the name only lives in brand.ts. */
const brandHtml = (): Plugin => ({
  name: 'shipfair:brand-html',
  transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
});

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare(), brandHtml()],
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
      // Never serve the read-only prototype (or secrets) from the dev server.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/reference/**'],
    },
  },
});
