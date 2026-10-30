import { Hono } from 'hono';
import * as z from 'zod';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';
import { publishMedia } from './media-publish.ts';
import { serviceDb } from './service.ts';
import { bumpWorldVersion } from './world.ts';

// Development-only routes. Everything here 404s outside `ENVIRONMENT=development`.
// - GET /u/:owner/:file serves approved media from the local R2 binding, standing in for the
//   media host (the SPA falls back to its own origin as media host in development).
// - POST /api/dev/booths/:id/approve|reject: the e2e "admin" until /admin exists (prompt 09).
//   They need the service-role key as a bearer token, which only the local machine has.

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

dev.use('/api/dev/booths/*', async (c, next) => {
  if (!isDev(c.env)) return c.notFound();
  const key = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || c.req.header('authorization') !== `Bearer ${key}`) {
    throw new AppError('unauthorized', 401, 'Development helper: service-role key required');
  }
  return next();
});

const MediaKeys = z.array(
  z.object({
    logo_key: z.string().nullable(),
    media: z.array(z.object({ key: z.string() })),
  }),
);

dev.post('/api/dev/booths/:id/approve', async (c) => {
  const id = c.req.param('id');
  const db = serviceDb(c.env);
  const booth = MediaKeys.parse(await db.select('booths', { id: `eq.${id}` }, 'logo_key,media'))[0];
  if (!booth) throw new AppError('not_found', 404, 'No such booth');
  const keys = [booth.logo_key, ...booth.media.map((m) => m.key)].filter(
    (k): k is string => k !== null,
  );
  const missing = await publishMedia(c.env, keys);
  await db.update(
    'booths',
    { id: `eq.${id}` },
    { status: 'approved', approved_at: new Date().toISOString(), reject_reason: null },
  );
  const version = await bumpWorldVersion(c.env.KV);
  return c.json({ ok: true, version, missing });
});

dev.post('/api/dev/booths/:id/reject', async (c) => {
  const id = c.req.param('id');
  const { reason } = z
    .object({ reason: z.string().min(1).max(300) })
    .parse(await c.req.json().catch(() => ({})));
  await serviceDb(c.env).update(
    'booths',
    { id: `eq.${id}` },
    { status: 'rejected', reject_reason: reason },
  );
  return c.json({ ok: true });
});
