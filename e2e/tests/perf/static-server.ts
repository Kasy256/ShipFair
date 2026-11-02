import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.ktx2': 'image/ktx2',
};
/** Cloudflare compresses text and WASM for browsers; binary formats go as they are. */
const COMPRESSED = new Set(['.html', '.js', '.css', '.json', '.wasm']);

export interface BuildServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Serves a production build (`apps/web/dist/client`) roughly as Cloudflare does: gzip (level 9;
 * Cloudflare sends brotli to Chrome, which is smaller, so this errs slow), long-lived caching for
 * hashed assets, the SPA fallback, and `/api/world` answered with `world`. No Worker, Supabase or
 * realtime: a load measurement only needs what happens before "Enter".
 */
export async function serveBuild(root: string, world: unknown): Promise<BuildServer> {
  const cache = new Map<string, Buffer>();
  const worldBody = gzipSync(JSON.stringify(world), { level: 9 });
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (path === '/api/world') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(worldBody);
      return;
    }
    let file = normalize(join(root, path));
    const isInside = file.startsWith(normalize(root));
    const isFile = isInside && statSync(file, { throwIfNoEntry: false })?.isFile() === true;
    if (!isFile) file = join(root, 'index.html'); // SPA routes
    const ext = extname(file);
    const isHashed = path.startsWith('/assets/');
    const headers: Record<string, string> = {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    let body = cache.get(file);
    if (!body) {
      const raw = readFileSync(file);
      body = COMPRESSED.has(ext) ? gzipSync(raw, { level: 9 }) : raw;
      cache.set(file, body);
    }
    if (COMPRESSED.has(ext)) headers['content-encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
