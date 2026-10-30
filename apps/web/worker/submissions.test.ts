import { env } from 'cloudflare:workers';
import { SubmitBoothResponse, SubmitRevisionResponse } from '@shipfair/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from './app.ts';
import type { Env } from './env.ts';
import {
  api,
  errorCode,
  fakeWebp,
  NEWBIE,
  OWNER,
  resetStub,
  seed,
  table,
  upload,
} from './test/helpers.ts';

const BOOTH = '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7b01';
const PASS = 'XXXX.DUMMY.TOKEN.XXXX';

interface BoothRow {
  id: string;
  status: string;
  media: { key: string; w: number; h: number }[];
  reject_reason: string | null;
}

let n = 0;
/** A draft owned by `owner` with a fresh logo and 2 screenshots in R2 (`pending/`). */
async function draft(
  overrides: Record<string, unknown> = {},
  owner = OWNER,
  token = 'owner-token',
) {
  n += 1;
  const logo = await upload(token, 'logo', fakeWebp(512, 512, n));
  const shots = [
    await upload(token, 'screenshot', fakeWebp(1280, 720, n + 100)),
    await upload(token, 'screenshot', fakeWebp(1280, 720, n + 200)),
  ];
  return {
    id: BOOTH,
    owner_id: owner,
    status: 'draft',
    slug: `booth-${n}`,
    name: 'Test Booth',
    tagline: 'A booth made by the Worker tests',
    description: null,
    url: 'https://ok.site.test/',
    district_id: 1,
    logo_key: logo,
    // Claimed sizes are wrong on purpose: the Worker stores the real ones.
    media: shots.map((key) => ({ type: 'image', key, w: 1, h: 1 })),
    pricing: 'free',
    reject_reason: null,
    ...overrides,
  };
}

const submit = (token = 'owner-token', id = BOOTH, turnstileToken = PASS) =>
  api(`/api/booths/${id}/submit`, { token, json: { turnstileToken } });

/** The app with some vars changed (the pool's bindings are fixed per run). */
const withEnv = (vars: Partial<Env>, path: string, body: unknown, token = 'owner-token') =>
  app.request(
    `https://web.test${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
    { ...(env as Env), ...vars },
  );

describe('POST /api/booths/:id/submit', () => {
  beforeEach(async () => {
    await resetStub();
  });

  it('runs the pre-screen, logs it and sets the booth pending', async () => {
    await seed({ booths: [await draft()] });
    const res = await submit();
    expect(res.status).toBe(200);
    const body = SubmitBoothResponse.parse(await res.json());
    expect(body.status).toBe('pending');
    // No vendor keys in tests: text and Safe Browsing are recorded as not checked.
    expect(body.prescreen).toEqual({
      score: 0,
      flags: ['safe_browsing_unchecked', 'text_unchecked'],
      finalUrl: 'https://ok.site.test/',
    });
    const [booth] = await table<BoothRow>('booths');
    expect(booth?.status).toBe('pending');
    expect(booth?.media.map((m) => [m.w, m.h])).toEqual([
      [1280, 720],
      [1280, 720],
    ]);
    const log = await table<{ action: string; target_id: string; actor_id: null }>(
      'moderation_log',
    );
    expect(log).toMatchObject([{ action: 'prescreen', target_type: 'booth', target_id: BOOTH }]);
  });

  it('is for the owner only', async () => {
    await seed({ booths: [await draft()] });
    expect((await submit('newbie-token')).status).toBe(404);
    expect(
      (await api(`/api/booths/${BOOTH}/submit`, { json: { turnstileToken: PASS } })).status,
    ).toBe(401);
    expect((await submit('owner-token', 'not-a-uuid')).status).toBe(404);
    expect((await table<BoothRow>('booths'))[0]?.status).toBe('draft');
  });

  it("fails with Cloudflare's always-fail Turnstile secret", async () => {
    await seed({ booths: [await draft()] });
    const res = await withEnv(
      { TURNSTILE_SECRET: '2x0000000000000000000000000000000AA' },
      `/api/booths/${BOOTH}/submit`,
      { turnstileToken: PASS },
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('turnstile_failed');
    expect((await table<BoothRow>('booths'))[0]?.status).toBe('draft');
  });

  it('needs a Turnstile token at all', async () => {
    await seed({ booths: [await draft()] });
    expect(await errorCode(await submit('owner-token', BOOTH, ''))).toBe('bad_request');
  });

  it('allows one booth in review at a time', async () => {
    const other = { ...(await draft()), id: crypto.randomUUID(), slug: 'other', status: 'pending' };
    await seed({ booths: [await draft(), other] });
    const res = await submit();
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('limit_pending');
  });

  it('caps makers at 3 booths (archived ones excepted)', async () => {
    const extra = async (status: string) => ({
      ...(await draft()),
      id: crypto.randomUUID(),
      slug: crypto.randomUUID().slice(0, 8),
      status,
    });
    await seed({
      booths: [
        await draft(),
        await extra('approved'),
        await extra('approved'),
        await extra('rejected'),
      ],
    });
    expect(await errorCode(await submit())).toBe('limit_total');
    await seed({
      booths: [
        await draft(),
        await extra('approved'),
        await extra('approved'),
        await extra('archived'),
      ],
    });
    expect((await submit()).status).toBe(200);
  });

  it('refuses accounts younger than MIN_ACCOUNT_AGE_MINUTES', async () => {
    await seed({ booths: [await draft({}, NEWBIE, 'newbie-token')] });
    const res = await withEnv(
      { MIN_ACCOUNT_AGE_MINUTES: '60' },
      `/api/booths/${BOOTH}/submit`,
      { turnstileToken: PASS },
      'newbie-token',
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('account_too_new');
  });

  it('re-validates the booth fields and needs a logo', async () => {
    await seed({ booths: [await draft({ tagline: 'short' })] });
    expect(await errorCode(await submit())).toBe('bad_request');
    await seed({ booths: [await draft({ logo_key: null })] });
    expect(await errorCode(await submit())).toBe('logo_missing');
    await seed({ booths: [await draft({ url: 'http://ok.site.test/' })] });
    expect(await errorCode(await submit())).toBe('bad_request');
  });

  it('checks the uploaded objects and deletes a bad one', async () => {
    const tiny = await upload('owner-token', 'logo', fakeWebp(128, 128, 900));
    await seed({ booths: [await draft({ logo_key: tiny })] });
    const res = await submit();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: 'media_invalid', message: 'Logo must be at least 256×256' },
    });
    expect(await (env as Env).MEDIA.head(`pending/${tiny}`)).toBeNull();
    const missing = `u/${OWNER}/${'c'.repeat(64)}.webp`;
    await seed({ booths: [await draft({ logo_key: missing })] });
    expect(await errorCode(await submit())).toBe('media_invalid');
  });

  it('rejects media from another account', async () => {
    const theirs = await upload('newbie-token', 'logo', fakeWebp(512, 512, 901));
    await seed({ booths: [await draft({ logo_key: theirs })] });
    expect(await errorCode(await submit())).toBe('media_invalid');
  });

  it('only submits drafts and rejected booths, and clears the old reason on resubmit', async () => {
    await seed({ booths: [await draft({ status: 'pending' })] });
    expect(await errorCode(await submit())).toBe('not_submittable');
    await seed({ booths: [await draft({ status: 'rejected', reject_reason: 'broken link' })] });
    expect((await submit()).status).toBe(200);
    expect((await table<BoothRow>('booths'))[0]).toMatchObject({
      status: 'pending',
      reject_reason: null,
    });
  });

  it('flags an unreachable link but still queues the booth', async () => {
    await seed({ booths: [await draft({ url: 'https://down.site.test/' })] });
    const body = SubmitBoothResponse.parse(await (await submit()).json());
    expect(body.prescreen.flags).toContain('url_unreachable');
    expect(body.prescreen.score).toBeGreaterThan(0);
  });
});

describe('POST /api/booths/:id/revision', () => {
  beforeEach(async () => {
    await resetStub();
  });

  const revise = async (tagline: string, token = 'owner-token') => {
    n += 1;
    const logo = await upload(token, 'logo', fakeWebp(512, 512, n));
    return api(`/api/booths/${BOOTH}/revision`, {
      token,
      json: {
        turnstileToken: PASS,
        revision: { tagline, url: 'https://hop.site.test/', logoKey: logo, media: [] },
      },
    });
  };

  it('stores one pending revision per live booth and leaves the booth as it is', async () => {
    await seed({ booths: [await draft({ status: 'approved' })] });
    const first = SubmitRevisionResponse.parse(
      await (await revise('A brand new tagline here')).json(),
    );
    expect(first.prescreen.finalUrl).toBe('https://ok.site.test/landing');
    const second = SubmitRevisionResponse.parse(
      await (await revise('Second thoughts on it')).json(),
    );
    expect(second.revisionId).toBe(first.revisionId);
    const revisions = await table<{ tagline: string; status?: string }>('booth_revisions');
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.tagline).toBe('Second thoughts on it');
    expect((await table<{ tagline: string }>('booths'))[0]?.tagline).toBe(
      'A booth made by the Worker tests',
    );
    const log = await table<{ target_type: string }>('moderation_log');
    expect(log.map((l) => l.target_type)).toEqual(['booth_revision', 'booth_revision']);
  });

  it('is only for live booths and their owner', async () => {
    await seed({ booths: [await draft()] });
    expect(await errorCode(await revise('Edit of a draft booth'))).toBe('not_submittable');
    await seed({ booths: [await draft({ status: 'approved' })] });
    expect((await revise('Not my booth to edit', 'newbie-token')).status).toBe(404);
  });
});

describe('POST /api/booths/check-url', () => {
  const check = (url: string) =>
    api('/api/booths/check-url', { token: 'owner-token', json: { url } });

  it('follows redirects and reports where the link lands', async () => {
    expect(await (await check('https://hop.site.test/')).json()).toEqual({
      isReachable: true,
      finalUrl: 'https://ok.site.test/landing',
    });
    expect(await (await check('https://down.site.test/')).json()).toEqual({
      isReachable: false,
      finalUrl: null,
    });
  });

  it('needs a user and an https link', async () => {
    expect(
      (await api('/api/booths/check-url', { json: { url: 'https://ok.site.test' } })).status,
    ).toBe(401);
    expect((await check('http://ok.site.test/')).status).toBe(400);
  });
});
