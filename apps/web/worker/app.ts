import { type SubmissionsStatus, Uuid } from '@shipfair/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { deleteAccount, requireUser } from './account.ts';
import { admin } from './admin/routes.ts';
import { dev } from './dev.ts';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';
import { readFlags } from './flags.ts';
import { health } from './health.ts';
import { claimStamps, mergeGuestPassport } from './passport.ts';
import { profilePage } from './profile-page.ts';
import { rateLimit } from './rate-limits.ts';
import { securityHeaders } from './security-headers.ts';
import { reportError } from './sentry.ts';
import { serviceDb } from './service.ts';
import { sharePage } from './share.ts';
import { checkBoothUrl, type SubmitContext, submitBooth, submitRevision } from './submissions.ts';
import { localUpload, signUpload } from './uploads.ts';
import { cachedWorld, WORLD_CACHE_CONTROL } from './world.ts';

export const app = new Hono<{ Bindings: Env }>();

const NO_STORE = { 'cache-control': 'no-store' } as const;

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

app.get('/api/health', async (c) => {
  const { body, status } = await health(c.env);
  return c.json(body, status, NO_STORE);
});

app.get('/api/world', async (c) => {
  const { json, status } = await cachedWorld(c.env, c.executionCtx, new URL(c.req.url).origin);
  return c.body(json, 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': WORLD_CACHE_CONTROL,
    'x-world-cache': status,
  });
});

app.get('/b/:slug', sharePage);
app.get('/u/:handle', profilePage);

app.post('/api/me/delete', async (c) => {
  const userId = await requireUser(c.env, c.req.header('authorization'));
  const body: unknown = await c.req.json().catch(() => null);
  return c.json(await deleteAccount(c.env, userId, body), 200, { 'cache-control': 'no-store' });
});

const jsonBody = (c: { req: { json(): Promise<unknown> } }) => c.req.json().catch(() => null);

app.post('/api/uploads/sign', async (c) => {
  const userId = await requireUser(c.env, c.req.header('authorization'));
  rateLimit('sign', userId);
  return c.json(await signUpload(c.env, userId, await jsonBody(c)), 200, NO_STORE);
});

// Development stand-in for a presigned R2 PUT (uploads.ts); 404 elsewhere.
app.put('/api/uploads/local', async (c) => {
  await localUpload(c.env, c.req.raw);
  return c.body(null, 200);
});

app.post('/api/booths/check-url', async (c) => {
  const userId = await requireUser(c.env, c.req.header('authorization'));
  rateLimit('checkUrl', userId);
  return c.json(await checkBoothUrl(await jsonBody(c)), 200, NO_STORE);
});

const submitContext = async (c: {
  env: Env;
  req: { header(name: string): string | undefined };
}): Promise<SubmitContext> => {
  const userId = await requireUser(c.env, c.req.header('authorization'));
  rateLimit('submit', userId);
  return { env: c.env, userId, remoteIp: c.req.header('cf-connecting-ip') };
};

app.post('/api/booths/:id/submit', async (c) => {
  const ctx = await submitContext(c);
  return c.json(await submitBooth(ctx, c.req.param('id'), await jsonBody(c)), 200, NO_STORE);
});

app.post('/api/booths/:id/revision', async (c) => {
  const ctx = await submitContext(c);
  return c.json(await submitRevision(ctx, c.req.param('id'), await jsonBody(c)), 200, NO_STORE);
});

// Passport (prompt 13): the browser asks, SQL decides from evidence (passport.ts).
app.post('/api/passport/stamp', async (c) => {
  const userId = await requireUser(c.env, c.req.header('authorization'));
  rateLimit('stamp', userId);
  return c.json(await claimStamps(c.env, userId, await jsonBody(c)), 200, NO_STORE);
});

app.post('/api/passport/merge', async (c) => {
  const userId = await requireUser(c.env, c.req.header('authorization'));
  rateLimit('merge', userId);
  return c.json(await mergeGuestPassport(c.env, userId, await jsonBody(c)), 200, NO_STORE);
});

/** A "Try it" click for the owner's chart. Anyone may send it; it is limited per IP. */
app.post('/api/booths/:id/try', async (c) => {
  const id = Uuid.safeParse(c.req.param('id'));
  if (!id.success) throw new AppError('bad_request', 400, 'Not a booth id');
  rateLimit('tryClick', c.req.header('cf-connecting-ip') ?? 'unknown');
  await serviceDb(c.env).rpc('record_try_click', { booth: id.data });
  return c.body(null, 204, NO_STORE);
});

/** The submit form's "Submissions are paused" notice (flag `SUBMISSIONS_OPEN`). */
app.get('/api/submissions/status', async (c) => {
  const flags = await readFlags(c.env);
  return c.json({ isOpen: flags.SUBMISSIONS_OPEN } satisfies SubmissionsStatus, 200, NO_STORE);
});

app.route('/', admin);

app.route('/', dev);

// Local proof that web → realtime RPC works through the dev registry. Hidden outside development.
app.get('/api/dev/ping-realtime', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') return c.notFound();
  return c.json({ ok: true, reply: await c.env.REALTIME.ping() });
});

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));

// The one place errors become `{ error: { code, message } }` (CODING_STANDARDS.md §3).
app.onError((error, c) => {
  if (error instanceof AppError) {
    if (error.status >= 500) {
      console.error(`${error.code}: ${error.message}`, error.cause);
      // 503s are an upstream (Supabase) being down: the uptime check on /api/health covers
      // them, and one outage at peak traffic would use up the month's Sentry quota.
      if (error.status !== 503) reportError(error);
    }
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof HTTPException && error.status < 500) {
    return c.json({ error: { code: 'bad_request', message: error.message } }, error.status);
  }
  console.error('Unhandled error', error);
  reportError(error);
  return c.json({ error: { code: 'internal', message: 'Something went wrong on our side' } }, 500);
});
