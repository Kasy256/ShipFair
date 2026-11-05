import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createSecureServer } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
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

export interface ServeOptions {
  /**
   * HTTP/2 over TLS, as Cloudflare serves the site (one connection, no 6-per-host limit), with a
   * throwaway self-signed certificate from `openssl`. Pages need `ignoreHTTPSErrors`.
   */
  isHttp2?: boolean;
}

/** A one-day self-signed certificate for 127.0.0.1 (files removed once read). */
function selfSigned(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), 'shipfair-cert-'));
  try {
    const key = join(dir, 'key.pem');
    const cert = join(dir, 'cert.pem');
    const run = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      // Git for Windows' openssl would rewrite "/CN=..." as a path otherwise.
      { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
    );
    if (run.status !== 0) throw new Error(`openssl failed: ${run.stderr || run.error}`);
    return { key: readFileSync(key), cert: readFileSync(cert) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Serves a production build (`apps/web/dist/client`) roughly as Cloudflare does: gzip (level 9;
 * Cloudflare sends brotli to Chrome, which is smaller, so this errs slow), long-lived caching for
 * hashed assets, the SPA fallback, and `/api/world` answered with `world`. No Worker, Supabase or
 * realtime: a load measurement only needs what happens before "Enter". HTTP/1.1 by default.
 */
export async function serveBuild(
  root: string,
  world: unknown,
  options: ServeOptions = {},
): Promise<BuildServer> {
  const cache = new Map<string, Buffer>();
  const worldBody = gzipSync(JSON.stringify(world), { level: 9 });
  // What the HTTP/1.1 and HTTP/2 compat request and response objects have in common.
  const handle = (
    req: { url?: string | undefined },
    res: {
      writeHead(status: number, headers: Record<string, string>): unknown;
      end(body: Buffer): unknown;
    },
  ) => {
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
  };
  // The browser keeps its connection open; closing must not wait for it.
  const sockets = new Set<{ destroy(): void }>();
  const server = options.isHttp2
    ? createSecureServer({ ...selfSigned(), allowHTTP1: true }, handle)
    : createServer(handle);
  server.on('connection', (socket: { destroy(): void; on(e: 'close', f: () => void): void }) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `${options.isHttp2 ? 'https' : 'http'}://127.0.0.1:${port}`,
    close: () =>
      new Promise((done) => {
        server.close(() => done());
        for (const socket of sockets) socket.destroy();
      }),
  };
}
