import {
  UPLOAD_MAX_B,
  UPLOAD_PENDING_PREFIX,
  UPLOAD_URL_TTL_S,
  UploadSignRequest,
  type UploadSignResponse,
  uploadKey,
} from '@shipfair/shared';
import { AwsClient } from 'aws4fetch';
import * as z from 'zod';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';

// POST /api/uploads/sign (ARCHITECTURE.md §6, §8). The browser re-encodes images to WebP, hashes
// them and asks for a URL. Objects are content-addressed (`u/<user>/<sha256>.webp`, so the same
// image twice is one object) and land under the private `pending/` prefix; approval copies them
// to the public prefix (prompt 09). The browser never sees R2 credentials.
//
// With R2 S3 credentials the URL is a presigned PUT with Content-Type, Content-Length and
// x-amz-checksum-sha256 in its signature. R2's docs only promise to enforce Content-Type, so
// `verifyUploads` (submit time) also re-hashes every object against its key. Miniflare has no S3
// endpoint, so in development without credentials the URL is this Worker's own upload route,
// which checks the same three things before writing to the R2 binding.

const LOCAL_UPLOAD_PATH = '/api/uploads/local';
const UPLOAD_CONTENT_TYPE = 'image/webp';

/** Where an upload's object lives until approval. */
export const pendingKey = (key: string) => `${UPLOAD_PENDING_PREFIX}${key}`;

const hexToBase64 = (hex: string) =>
  btoa(String.fromCharCode(...(hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16))));

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const R2Credentials = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
});
type R2Credentials = z.infer<typeof R2Credentials>;

/** A presigned R2 PUT for `objectKey`, valid UPLOAD_URL_TTL_S, binding type, size and hash. */
export async function presignPut(
  creds: R2Credentials,
  objectKey: string,
  upload: { bytes: number; sha256: string },
  now = new Date(),
): Promise<{ url: string; headers: Record<string, string> }> {
  const client = new AwsClient({
    accessKeyId: creds.R2_ACCESS_KEY_ID,
    secretAccessKey: creds.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const url = new URL(
    `https://${creds.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${creds.R2_BUCKET}/${objectKey}`,
  );
  url.searchParams.set('X-Amz-Expires', String(UPLOAD_URL_TTL_S));
  const headers = {
    'content-type': UPLOAD_CONTENT_TYPE,
    'x-amz-checksum-sha256': hexToBase64(upload.sha256),
  };
  const signed = await client.sign(url.toString(), {
    method: 'PUT',
    headers: { ...headers, 'content-length': String(upload.bytes) },
    aws: {
      signQuery: true,
      allHeaders: true,
      datetime: now.toISOString().replace(/[:-]|\.\d{3}/g, ''),
    },
  });
  // Browsers set Content-Length from the body themselves (it's a forbidden header to script).
  return { url: signed.url, headers };
}

// Development upload tokens: base64url(JSON payload) + '.' + hex HMAC-SHA256 of it.
const LocalToken = z.object({
  key: z.string(),
  bytes: z.int().positive(),
  sha256: z.string(),
  exp: z.int(),
});
type LocalToken = z.infer<typeof LocalToken>;

const toBase64Url = (text: string) =>
  btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromBase64Url = (text: string) => atob(text.replaceAll('-', '+').replaceAll('_', '/'));

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The local route's signing secret: development only, and never sent to the browser. */
function localSecret(env: Env): string | null {
  if (env.ENVIRONMENT !== 'development') return null;
  return env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

async function localUploadUrl(secret: string, token: LocalToken): Promise<string> {
  const payload = toBase64Url(JSON.stringify(token));
  return `${LOCAL_UPLOAD_PATH}?t=${payload}.${await hmac(secret, payload)}`;
}

export async function signUpload(
  env: Env,
  userId: string,
  body: unknown,
  now = Date.now(),
): Promise<UploadSignResponse> {
  const parsed = UploadSignRequest.safeParse(body);
  if (!parsed.success) throw new AppError('bad_request', 400, 'Uploads must be WebP images');
  const { kind, bytes, sha256 } = parsed.data;
  const max = UPLOAD_MAX_B[kind];
  if (bytes > max) {
    throw new AppError('too_large', 413, `A ${kind} can be at most ${Math.round(max / 1024)} KB`);
  }
  const key = uploadKey(userId, sha256);
  const objectKey = pendingKey(key);

  // Same bytes already uploaded (or already approved): nothing to send.
  const existing = (await env.MEDIA.head(objectKey)) ?? (await env.MEDIA.head(key));
  if (existing && existing.size === bytes) return { key, url: '', headers: {}, isNeeded: false };

  const creds = R2Credentials.safeParse(env);
  if (creds.success) {
    const signed = await presignPut(creds.data, objectKey, { bytes, sha256 }, new Date(now));
    return { key, ...signed, isNeeded: true };
  }
  const secret = localSecret(env);
  if (!secret) throw new AppError('unavailable', 503, 'Uploads are not configured');
  const exp = Math.floor(now / 1000) + UPLOAD_URL_TTL_S;
  const url = await localUploadUrl(secret, { key, bytes, sha256, exp });
  return { key, url, headers: { 'content-type': UPLOAD_CONTENT_TYPE }, isNeeded: true };
}

/**
 * PUT /api/uploads/local?t=… (development only): what a presigned R2 PUT does, against the R2
 * binding. Checks the token, expiry, type, size and sha256 before writing under `pending/`.
 */
export async function localUpload(env: Env, request: Request, now = Date.now()): Promise<void> {
  const secret = localSecret(env);
  if (!secret) throw new AppError('not_found', 404, 'Route not found');
  const [payload = '', mac = ''] = (new URL(request.url).searchParams.get('t') ?? '').split('.');
  if (!payload || mac !== (await hmac(secret, payload))) {
    throw new AppError('forbidden', 403, 'Bad upload signature');
  }
  const token = LocalToken.safeParse(
    (() => {
      try {
        return JSON.parse(fromBase64Url(payload));
      } catch {
        return null;
      }
    })(),
  );
  if (!token.success || token.data.exp * 1000 < now) {
    throw new AppError('forbidden', 403, 'Upload URL expired');
  }
  if (request.headers.get('content-type') !== UPLOAD_CONTENT_TYPE) {
    throw new AppError('forbidden', 403, 'Content-Type does not match the signature');
  }
  const body = await request.arrayBuffer();
  if (body.byteLength !== token.data.bytes) {
    throw new AppError('forbidden', 403, 'Content-Length does not match the signature');
  }
  if ((await sha256Hex(body)) !== token.data.sha256) {
    throw new AppError('upload_invalid', 400, 'The upload does not match its checksum');
  }
  await env.MEDIA.put(pendingKey(token.data.key), body, {
    httpMetadata: { contentType: UPLOAD_CONTENT_TYPE },
  });
}
