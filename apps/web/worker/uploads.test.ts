import { env, exports } from 'cloudflare:workers';
import { UploadSignResponse } from '@shipfair/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from './env.ts';
import { api, errorCode, fakeWebp, OWNER, resetStub, upload } from './test/helpers.ts';
import { presignPut, sha256Hex, signUpload } from './uploads.ts';

const sign = async (body: unknown, token = 'owner-token') =>
  api('/api/uploads/sign', { token, json: body });

const webpRequest = async (bytes: Uint8Array, kind = 'logo') => ({
  kind,
  contentType: 'image/webp',
  bytes: bytes.length,
  sha256: await sha256Hex(bytes),
});

describe('POST /api/uploads/sign', () => {
  beforeEach(async () => {
    await resetStub();
  });

  it('needs a signed-in user', async () => {
    const res = await api('/api/uploads/sign', { json: await webpRequest(fakeWebp(512, 512)) });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('unauthorized');
  });

  it('accepts WebP only', async () => {
    const body = { ...(await webpRequest(fakeWebp(512, 512))), contentType: 'image/png' };
    const res = await sign(body);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('bad_request');
  });

  it('enforces the size limits per kind (logo 300 KB, screenshot 600 KB)', async () => {
    const sha256 = 'a'.repeat(64);
    const at = (kind: string, bytes: number) =>
      sign({ kind, contentType: 'image/webp', bytes, sha256 });
    expect((await at('logo', 300 * 1024)).status).toBe(200);
    const bigLogo = await at('logo', 300 * 1024 + 1);
    expect(bigLogo.status).toBe(413);
    expect(await errorCode(bigLogo)).toBe('too_large');
    expect((await at('screenshot', 600 * 1024)).status).toBe(200);
    expect((await at('screenshot', 600 * 1024 + 1)).status).toBe(413);
  });

  it('returns a content-addressed key under the caller and a short-lived upload URL', async () => {
    const bytes = fakeWebp(512, 512, 1);
    const res = await sign(await webpRequest(bytes));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = UploadSignResponse.parse(await res.json());
    expect(body.key).toBe(`u/${OWNER}/${await sha256Hex(bytes)}.webp`);
    expect(body.isNeeded).toBe(true);
    expect(body.url).toMatch(/^\/api\/uploads\/local\?t=/);
    expect(body.headers).toEqual({ 'content-type': 'image/webp' });
  });

  it('writes the object under the private pending/ prefix, and dedupes a second upload', async () => {
    const bytes = fakeWebp(512, 512, 2);
    const key = await upload('owner-token', 'logo', bytes);
    expect(await (env as Env).MEDIA.head(`pending/${key}`)).not.toBeNull();
    expect(await (env as Env).MEDIA.head(key)).toBeNull();
    const again = UploadSignResponse.parse(await (await sign(await webpRequest(bytes))).json());
    expect(again).toMatchObject({ key, isNeeded: false });
  });
});

describe('PUT /api/uploads/local (development stand-in for R2)', () => {
  const signed = async (bytes: Uint8Array) =>
    UploadSignResponse.parse(await (await sign(await webpRequest(bytes))).json());
  const put = (url: string, body: Uint8Array, contentType = 'image/webp') =>
    exports.default.fetch(`https://web.test${url}`, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body,
    });

  it('refuses content that does not match the signed hash', async () => {
    const bytes = fakeWebp(512, 512, 3);
    const { url, key } = await signed(bytes);
    const swapped = fakeWebp(512, 512, 4);
    const res = await put(url, swapped);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('upload_invalid');
    expect(await (env as Env).MEDIA.head(`pending/${key}`)).toBeNull();
  });

  it('refuses a different size, type or a tampered token', async () => {
    const bytes = fakeWebp(512, 512, 5);
    const { url } = await signed(bytes);
    expect((await put(url, fakeWebp(512, 512, 5, 300))).status).toBe(403);
    expect((await put(url, bytes, 'image/png')).status).toBe(403);
    expect(
      (
        await put(
          url.replace(/.$/, (c) => (c === '0' ? '1' : '0')),
          bytes,
        )
      ).status,
    ).toBe(403);
  });

  it('refuses an expired URL', async () => {
    const bytes = fakeWebp(512, 512, 6);
    const old = await signUpload(env as Env, OWNER, await webpRequest(bytes), Date.now() - 600_000);
    expect((await put(old.url, bytes)).status).toBe(403);
  });
});

describe('presigned R2 URLs', () => {
  const creds = {
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'shipfair-media-staging',
  };

  it('sign type, size and checksum into a 5-minute PUT under pending/', async () => {
    const sha = 'ab'.repeat(32);
    const { url, headers } = await presignPut(creds, `pending/u/${OWNER}/${sha}.webp`, {
      bytes: 1234,
      sha256: sha,
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe('acct.r2.cloudflarestorage.com');
    expect(parsed.pathname).toBe(`/shipfair-media-staging/pending/u/${OWNER}/${sha}.webp`);
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host;x-amz-checksum-sha256',
    );
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    // base64 of the raw digest, as S3 expects
    expect(headers).toEqual({
      'content-type': 'image/webp',
      'x-amz-checksum-sha256': btoa(String.fromCharCode(...Array(32).fill(0xab))),
    });
  });

  it('are used whenever R2 credentials are configured', async () => {
    const bytes = fakeWebp(512, 512, 7);
    const res = await signUpload({ ...(env as Env), ...creds }, OWNER, await webpRequest(bytes));
    expect(res.url).toMatch(
      /^https:\/\/acct\.r2\.cloudflarestorage\.com\/shipfair-media-staging\/pending\//,
    );
  });

  it('are required outside development', async () => {
    const production = { ...(env as Env), ENVIRONMENT: 'production' as const };
    await expect(
      signUpload(production, OWNER, await webpRequest(fakeWebp(512, 512, 8))),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});
