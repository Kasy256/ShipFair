import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import pkg from '../package.json';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';
import { securityHeaders } from './security-headers.ts';
import { sharePage } from './share.ts';
import { cachedWorld, WORLD_CACHE_CONTROL } from './world.ts';

export const app = new Hono<{ Bindings: Env }>();

app.use(async (c, next) => {
  await next();
  const headers = securityHeaders({
    mediaHost: import.meta.env.VITE_MEDIA_HOST,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    realtimeHost: import.meta.env.VITE_REALTIME_HOST,
    isDev: c.env.ENVIRONMENT === 'development',
  });
  for (const [name, value] of Object.entries(headers)) c.res.headers.set(name, value);
});

app.get('/api/health', (c) => c.json({ ok: true, version: pkg.version }));

app.get('/api/world', async (c) => {
  const { json, status } = await cachedWorld(c.env, c.executionCtx, new URL(c.req.url).origin);
  return c.body(json, 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': WORLD_CACHE_CONTROL,
    'x-world-cache': status,
  });
});

app.get('/b/:slug', sharePage);

// Local proof that web → realtime RPC works through the dev registry. Hidden outside development.
app.get('/api/dev/ping-realtime', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') return c.notFound();
  return c.json({ ok: true, reply: await c.env.REALTIME.ping() });
});

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));

// The one place errors become `{ error: { code, message } }` (CODING_STANDARDS.md §3).
app.onError((error, c) => {
  if (error instanceof AppError) {
    if (error.status >= 500) console.error(`${error.code}: ${error.message}`, error.cause);
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof HTTPException && error.status < 500) {
    return c.json({ error: { code: 'bad_request', message: error.message } }, error.status);
  }
  console.error('Unhandled error', error);
  return c.json({ error: { code: 'internal', message: 'Something went wrong on our side' } }, 500);
});
