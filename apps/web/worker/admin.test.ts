import { env } from 'cloudflare:workers';
import { AdminActionResponse, AdminMe, QueuePage, SubmissionsStatus } from '@shipfair/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from './env.ts';
import {
  api,
  errorCode,
  fakeWebp,
  OWNER,
  realtimeCalls,
  resetStub,
  STAFF,
  seed,
  table,
  upload,
} from './test/helpers.ts';
import { readWorldVersion } from './world.ts';

const BOOTH = '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7c01';

/** Every admin route, with a body that would be valid for staff. */
const ROUTES: [method: string, path: string, json?: unknown][] = [
  ['GET', '/api/admin/me'],
  ['GET', '/api/admin/queue'],
  ['GET', '/api/admin/reports'],
  ['GET', '/api/admin/users?q=maker'],
  ['GET', `/api/admin/users/${OWNER}`],
  ['GET', '/api/admin/log'],
  ['GET', '/api/admin/flags'],
  ['GET', `/api/admin/media/u/${OWNER}/${'a'.repeat(64)}.webp`],
  ['POST', `/api/admin/booths/${BOOTH}/approve`, {}],
  ['POST', `/api/admin/booths/${BOOTH}/reject`, { reason: 'broken_link' }],
  ['POST', '/api/admin/hide', { targetType: 'booth', targetId: BOOTH, hidden: true }],
  ['POST', '/api/admin/ban', { userId: OWNER, reason: 'spam' }],
  ['POST', '/api/admin/unban', { userId: OWNER }],
  ['POST', '/api/admin/reports/1', { status: 'dismissed' }],
  ['PUT', '/api/admin/flags', { key: 'SUBMISSIONS_OPEN', value: false }],
];

const call = (method: string, path: string, json: unknown, token?: string) =>
  api(path, { method, ...(token ? { token } : {}), ...(json === undefined ? {} : { json }) });

/** A pending booth whose logo and screenshot wait under `pending/` in R2. */
async function pendingBooth() {
  const logo = await upload('owner-token', 'logo', fakeWebp(512, 512, 501));
  const shot = await upload('owner-token', 'screenshot', fakeWebp(1280, 720, 502));
  return {
    id: BOOTH,
    owner_id: OWNER,
    status: 'pending',
    slug: 'admin-test',
    name: 'Admin Test',
    tagline: 'A booth waiting for a moderator',
    description: null,
    url: 'https://ok.site.test/',
    district_id: 1,
    logo_key: logo,
    media: [{ type: 'image', key: shot, w: 1280, h: 720 }],
    pricing: 'free',
    reject_reason: null,
  };
}

describe('/api/admin access', () => {
  beforeEach(async () => {
    await resetStub();
  });

  it('answers 401 without a session and 403 for non-staff, on every route', async () => {
    const results: string[] = [];
    for (const [method, path, json] of ROUTES) {
      const anonymous = await call(method, path, json);
      const user = await call(method, path, json, 'owner-token');
      results.push(`${method} ${path} ${anonymous.status} ${user.status}`);
      expect(await errorCode(user)).toBe('forbidden');
    }
    expect(results).toEqual(ROUTES.map(([method, path]) => `${method} ${path} 401 403`));
    // Nothing reached admin_action.
    expect(await table('moderation_log')).toEqual([]);
  });

  it('tells staff who they are', async () => {
    const res = await api('/api/admin/me', { token: 'staff-token' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(AdminMe.parse(await res.json())).toEqual({
      userId: STAFF,
      handle: 'staffer',
      role: 'admin',
    });
  });
});

describe('POST /api/admin/booths/:id/approve', () => {
  beforeEach(async () => {
    await resetStub();
  });

  it('approves, publishes media, logs, bumps the world version and tells realtime', async () => {
    const booth = await pendingBooth();
    await seed({ booths: [booth] });
    const before = await readWorldVersion((env as Env).KV);

    const res = await api(`/api/admin/booths/${BOOTH}/approve`, { token: 'staff-token', json: {} });
    expect(res.status).toBe(200);
    const body = AdminActionResponse.parse(await res.json());
    expect(body.worldVersion).toBe(before + 1);
    expect(await readWorldVersion((env as Env).KV)).toBe(before + 1);

    expect((await table<{ status: string }>('booths'))[0]?.status).toBe('approved');
    expect(await table('moderation_log')).toMatchObject([
      {
        actor_id: STAFF,
        actor_handle: 'staffer',
        action: 'approve',
        target_type: 'booth',
        target_id: BOOTH,
        detail: { missingMedia: [] },
      },
    ]);
    const media = (env as Env).MEDIA;
    expect(await media.head(booth.logo_key)).not.toBeNull();
    expect(await media.head(`pending/${booth.logo_key}`)).toBeNull();
    expect(await realtimeCalls()).toEqual([['worldUpdate', [BOOTH]]]);
  });

  it('applies a pending edit of a live booth', async () => {
    const booth = await pendingBooth();
    const newLogo = await upload('owner-token', 'logo', fakeWebp(512, 512, 503));
    await seed({
      booths: [{ ...booth, status: 'approved' }],
      booth_revisions: [
        {
          id: '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7c99',
          booth_id: BOOTH,
          owner_id: OWNER,
          status: 'pending',
          tagline: 'The tagline after the edit',
          description: null,
          url: 'https://ok.site.test/v2',
          logo_key: newLogo,
          media: [],
        },
      ],
    });
    const res = await api(`/api/admin/booths/${BOOTH}/approve`, { token: 'staff-token', json: {} });
    expect(res.status).toBe(200);
    expect((await table<{ tagline: string }>('booths'))[0]?.tagline).toBe(
      'The tagline after the edit',
    );
    expect(await (env as Env).MEDIA.head(newLogo)).not.toBeNull();
    expect((await table<{ action: string }>('moderation_log'))[0]?.action).toBe('approve_revision');
  });

  it('refuses a booth with nothing to review', async () => {
    await seed({ booths: [{ ...(await pendingBooth()), status: 'rejected' }] });
    const res = await api(`/api/admin/booths/${BOOTH}/approve`, { token: 'staff-token', json: {} });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('not_actionable');
    expect(await realtimeCalls()).toEqual([]);
  });
});

describe('POST /api/admin/booths/:id/reject', () => {
  beforeEach(async () => {
    await resetStub();
  });

  it('stores the reason text the maker will read', async () => {
    await seed({ booths: [await pendingBooth()] });
    const res = await api(`/api/admin/booths/${BOOTH}/reject`, {
      token: 'staff-token',
      json: { reason: 'broken_link', note: 'The page answers 404' },
    });
    expect(res.status).toBe(200);
    expect((await table('booths'))[0]).toMatchObject({
      status: 'rejected',
      reject_reason: 'Broken link: The page answers 404',
    });
  });

  it('needs a reason from the list, and a note for "other"', async () => {
    await seed({ booths: [await pendingBooth()] });
    for (const json of [{}, { reason: 'ugly' }, { reason: 'other' }]) {
      const res = await api(`/api/admin/booths/${BOOTH}/reject`, { token: 'staff-token', json });
      expect(res.status).toBe(400);
    }
    expect((await table('booths'))[0]).toMatchObject({ status: 'pending' });
  });
});

describe('POST /api/admin/ban', () => {
  beforeEach(async () => {
    await resetStub();
  });

  it('bans, logs and kicks the user from realtime', async () => {
    const res = await api('/api/admin/ban', {
      token: 'staff-token',
      json: { userId: OWNER, reason: 'Spam in chat' },
    });
    expect(res.status).toBe(200);
    expect(await table('bans')).toMatchObject([{ user_id: OWNER, reason: 'Spam in chat' }]);
    expect(await table('moderation_log')).toMatchObject([{ action: 'ban', target_id: OWNER }]);
    expect(await realtimeCalls()).toEqual([['kick', OWNER, 'banned']]);
  });

  it('refuses staff, past end dates, and does not kick then', async () => {
    const self = await api('/api/admin/ban', {
      token: 'staff-token',
      json: { userId: STAFF, reason: 'Testing' },
    });
    expect(self.status).toBe(409);
    const past = await api('/api/admin/ban', {
      token: 'staff-token',
      json: { userId: OWNER, reason: 'Spam', until: '2020-01-01T00:00:00Z' },
    });
    expect(past.status).toBe(400);
    expect(await realtimeCalls()).toEqual([]);
  });
});

describe('flags', () => {
  beforeEach(async () => {
    await resetStub();
  });

  it('turning SUBMISSIONS_OPEN off pauses submissions at once in this isolate', async () => {
    const status = async () =>
      SubmissionsStatus.parse(await (await api('/api/submissions/status')).json());
    expect(await status()).toEqual({ isOpen: true });
    const res = await api('/api/admin/flags', {
      method: 'PUT',
      token: 'staff-token',
      json: { key: 'SUBMISSIONS_OPEN', value: false },
    });
    expect(res.status).toBe(200);
    expect(await status()).toEqual({ isOpen: false });
    expect(await table('moderation_log')).toMatchObject([
      { action: 'set_flag', target_type: 'flag', target_id: 'SUBMISSIONS_OPEN' },
    ]);
  });

  it('refuses values of the wrong type', async () => {
    const res = await api('/api/admin/flags', {
      method: 'PUT',
      token: 'staff-token',
      json: { key: 'GUEST_CHAT', value: true },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/queue', () => {
  beforeEach(async () => {
    await resetStub();
  });

  it('builds cards with the maker and their other booths', async () => {
    const booth = await pendingBooth();
    await seed({
      booths: [
        booth,
        { ...booth, id: '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7c02', slug: 'older', status: 'approved' },
      ],
      admin_review_queue: [
        {
          kind: 'booth',
          id: BOOTH,
          booth_id: BOOTH,
          owner_id: OWNER,
          submitted_at: '2026-10-30T10:00:00+00:00',
          score: 0,
          flags: ['text_unchecked'],
          final_url: 'https://ok.site.test/landing',
        },
      ],
    });
    const res = await api('/api/admin/queue', { token: 'staff-token' });
    expect(res.status).toBe(200);
    const page = QueuePage.parse(await res.json());
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      kind: 'booth',
      boothId: BOOTH,
      finalUrl: 'https://ok.site.test/landing',
      maker: { handle: 'maker1', otherBooths: [{ slug: 'older', status: 'approved' }] },
    });
  });

  it('refuses a cursor it did not make', async () => {
    const res = await api('/api/admin/queue?cursor=bm9wZQ', { token: 'staff-token' });
    expect(res.status).toBe(400);
  });
});
