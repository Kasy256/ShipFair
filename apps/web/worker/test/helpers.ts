import { env, exports } from 'cloudflare:workers';
import { ApiError, type UploadKind, UploadSignResponse } from '@shipfair/shared';
import type { Env } from '../env.ts';
import { forgetFlags } from '../flags.ts';
import { resetRateLimits } from '../rate-limits.ts';
import { sha256Hex } from '../uploads.ts';

// Shared by the Worker tests. The stub (supabase-stub.mjs) knows these tokens and users.

export const OWNER = '00000000-0000-4000-8000-000000000001';
export const NEWBIE = '00000000-0000-4000-8000-000000000002';
/** An admin (`staff-token`). */
export const STAFF = '00000000-0000-4000-8000-000000000003';

export const stub = (path: string, init?: RequestInit) =>
  fetch(`http://supabase.test${path}`, init);

/** RPC calls the realtime stub received since the last read (vitest.config.ts). */
export const realtimeCalls = async (): Promise<unknown[][]> =>
  (await (
    await (env as Env).REALTIME.fetch('https://realtime.test/__calls')
  ).json()) as unknown[][];

/** Fresh stub tables, rate limits, flags and realtime calls (they all outlive a test). */
export const resetStub = async () => {
  resetRateLimits();
  forgetFlags();
  await realtimeCalls();
  return stub('/__mode', { method: 'POST', body: 'ok' });
};
export const seed = (tables: Record<string, unknown[]>) =>
  stub('/__seed', { method: 'POST', body: JSON.stringify(tables) });
export const table = async <T = Record<string, unknown>>(name: string) =>
  (await (await stub(`/__table/${name}`)).json()) as T[];

export const errorCode = async (res: Response) => ApiError.parse(await res.json()).error.code;

/** A request to the Worker under test, as `token`'s user. */
export function api(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const { token, json, headers, ...rest } = init;
  return exports.default.fetch(`https://web.test${path}`, {
    ...rest,
    method: rest.method ?? (json === undefined ? 'GET' : 'POST'),
    headers: {
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
}

/**
 * Bytes with a valid lossless (VP8L) WebP header for `w`×`h`, padded with `seed` so each fake is
 * a distinct object. The Worker only reads the header, so the pixels needn't decode.
 */
export function fakeWebp(w: number, h: number, seed = 0, size = 256): Uint8Array {
  const b = new Uint8Array(size);
  const ascii = (at: number, text: string) =>
    b.set(
      [...text].map((ch) => ch.charCodeAt(0)),
      at,
    );
  ascii(0, 'RIFF');
  new DataView(b.buffer).setUint32(4, size - 8, true);
  ascii(8, 'WEBP');
  ascii(12, 'VP8L');
  const bits = (w - 1) | ((h - 1) << 14);
  b.set([0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, bits >>> 24], 20);
  b.fill(seed & 0xff, 30);
  return b;
}

/** Signs and uploads `bytes` as `token`'s user; returns the key. */
export async function upload(token: string, kind: UploadKind, bytes: Uint8Array): Promise<string> {
  const res = await api('/api/uploads/sign', {
    token,
    json: { kind, contentType: 'image/webp', bytes: bytes.length, sha256: await sha256Hex(bytes) },
  });
  if (res.status !== 200) throw new Error(`sign failed: ${res.status} ${await res.text()}`);
  const signed = UploadSignResponse.parse(await res.json());
  if (signed.isNeeded) {
    const put = await exports.default.fetch(`https://web.test${signed.url}`, {
      method: 'PUT',
      headers: signed.headers,
      body: bytes,
    });
    if (put.status !== 200) throw new Error(`upload failed: ${put.status} ${await put.text()}`);
  }
  return signed.key;
}
