import { Hono } from 'hono';
import type { Env } from '../env.ts';
import {
  type AdminContext,
  approveBooth,
  ban,
  hide,
  rejectBooth,
  setFlag,
  setReportStatus,
  unban,
} from './actions.ts';
import { reviewQueue } from './queue.ts';
import { reportInbox } from './reports.ts';
import { requireStaff, type Staff } from './staff.ts';
import { adminFlags, moderationLog, searchUsers, userDetail } from './users.ts';

// `/api/admin/*` (prompt 09). The middleware verifies the caller's JWT with Supabase Auth and
// their staff role with the service role before any handler runs; there is no other way in.

export const admin = new Hono<{ Bindings: Env; Variables: { staff: Staff } }>();

const MEDIA_KEY = /^u\/[0-9a-f-]{36}\/[0-9a-f]{64}\.webp$/;

admin.use('/api/admin/*', async (c, next) => {
  c.set('staff', await requireStaff(c.env, c.req.header('authorization')));
  await next();
  c.header('cache-control', 'no-store'); // every answer here is per-staff and live
});

const ctx = (c: { env: Env; get(key: 'staff'): Staff }): AdminContext => ({
  env: c.env,
  staff: c.get('staff'),
});
const jsonBody = (c: { req: { json(): Promise<unknown> } }) => c.req.json().catch(() => null);

admin.get('/api/admin/me', (c) => c.json(c.get('staff')));

admin.get('/api/admin/queue', async (c) => c.json(await reviewQueue(c.env, c.req.query('cursor'))));
admin.get('/api/admin/reports', async (c) =>
  c.json(await reportInbox(c.env, c.req.query('cursor'))),
);
admin.get('/api/admin/users', async (c) =>
  c.json(await searchUsers(c.env, c.req.query('q'), c.req.query('cursor'))),
);
admin.get('/api/admin/users/:id', async (c) => c.json(await userDetail(c.env, c.req.param('id'))));
admin.get('/api/admin/log', async (c) => {
  const { cursor, ...filters } = c.req.query();
  return c.json(await moderationLog(c.env, filters, cursor));
});
admin.get('/api/admin/flags', async (c) => c.json(await adminFlags(c.env)));

/** Unreviewed media lives under the private `pending/` prefix; staff see it through here. */
admin.get('/api/admin/media/*', async (c) => {
  const key = c.req.path.slice('/api/admin/media/'.length);
  if (!MEDIA_KEY.test(key)) return c.notFound();
  const object = (await c.env.MEDIA.get(`pending/${key}`)) ?? (await c.env.MEDIA.get(key));
  if (!object) return c.notFound();
  return c.body(object.body, 200, {
    'content-type': 'image/webp',
    'cache-control': 'private, no-store',
  });
});

admin.post('/api/admin/booths/:id/approve', async (c) =>
  c.json(await approveBooth(ctx(c), c.req.param('id'))),
);
admin.post('/api/admin/booths/:id/reject', async (c) =>
  c.json(await rejectBooth(ctx(c), c.req.param('id'), await jsonBody(c))),
);
admin.post('/api/admin/hide', async (c) => c.json(await hide(ctx(c), await jsonBody(c))));
admin.post('/api/admin/ban', async (c) => c.json(await ban(ctx(c), await jsonBody(c))));
admin.post('/api/admin/unban', async (c) => c.json(await unban(ctx(c), await jsonBody(c))));
admin.post('/api/admin/reports/:id', async (c) =>
  c.json(await setReportStatus(ctx(c), c.req.param('id'), await jsonBody(c))),
);
admin.put('/api/admin/flags', async (c) => c.json(await setFlag(ctx(c), await jsonBody(c))));
