import { Hono } from 'hono';
import * as z from 'zod';
import type { Env } from './env.ts';

// Development-only routes. Everything here 404s outside `ENVIRONMENT=development`.
// - GET /u/:owner/:file serves approved media from the local R2 binding, standing in for the
//   media host (the SPA falls back to its own origin as media host in development).

export const dev = new Hono<{ Bindings: Env }>();

const isDev = (env: Env) => env.ENVIRONMENT === 'development';
const MEDIA_FILE = /^[0-9a-f]{64}\.webp$/;
const Uuid = z.uuid();

dev.get('/u/:owner/:file', async (c) => {
  const { owner, file } = c.req.param();
  // Anything else under /u/ is an SPA page (passports, later): hand it to the static assets.
  if (!isDev(c.env) || !Uuid.safeParse(owner).success || !MEDIA_FILE.test(file)) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  const object = await c.env.MEDIA.get(`u/${owner}/${file}`);
  if (!object) return c.notFound();
  return c.body(object.body, 200, {
    'content-type': 'image/webp',
    'cache-control': 'public, max-age=31536000, immutable',
    'access-control-allow-origin': '*',
  });
});
