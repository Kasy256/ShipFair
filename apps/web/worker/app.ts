import { Hono } from 'hono';
import pkg from '../package.json';
import type { Env } from './env.ts';

export const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, version: pkg.version }));

// Local proof that web → realtime RPC works through the dev registry. Hidden outside development.
app.get('/api/dev/ping-realtime', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') return c.notFound();
  return c.json({ ok: true, reply: await c.env.REALTIME.ping() });
});

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
