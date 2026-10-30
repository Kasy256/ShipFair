import {
  keySha256,
  LOGO_MIN_PX,
  LOGO_PX,
  SCREENSHOT_MAX_W_PX,
  SCREENSHOT_MIN_W_PX,
  UPLOAD_MAX_B,
  type UploadKind,
  WEBP_HEADER_BYTES,
  webpSize,
} from '@shipfair/shared';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';
import { pendingKey, sha256Hex } from './uploads.ts';

// Submit-time checks on the objects a booth points at (prompt 08 §4): each must exist, be WebP,
// fit its size limit, hash to the sha256 in its key (so a presigned PUT can't swap content even
// if R2 ignored the signed checksum), and have sane dimensions. A failing pending object is
// deleted, so a bad upload can't be retried into review. Approved (public) objects are only read.

export interface MediaRef {
  readonly key: string;
  readonly kind: UploadKind;
}

export interface VerifiedMedia extends MediaRef {
  readonly w: number;
  readonly h: number;
}

const LABEL: Record<UploadKind, string> = { logo: 'Logo', screenshot: 'Screenshot' };

/** Null when fine, else what's wrong, in words the form can show. */
export function dimensionProblem(kind: UploadKind, w: number, h: number): string | null {
  if (kind === 'logo') {
    if (w !== h) return 'Logo must be square';
    if (w < LOGO_MIN_PX) return `Logo must be at least ${LOGO_MIN_PX}×${LOGO_MIN_PX}`;
    if (w > LOGO_PX) return `Logo must be at most ${LOGO_PX}×${LOGO_PX}`;
    return null;
  }
  if (w < SCREENSHOT_MIN_W_PX) return `Screenshots must be at least ${SCREENSHOT_MIN_W_PX} px wide`;
  if (w > SCREENSHOT_MAX_W_PX || h > SCREENSHOT_MAX_W_PX) {
    return `Screenshots must be at most ${SCREENSHOT_MAX_W_PX} px on each side`;
  }
  return null;
}

async function verifyOne(env: Env, ownerId: string, ref: MediaRef): Promise<VerifiedMedia> {
  const label = LABEL[ref.kind];
  const sha = keySha256(ref.key);
  if (!sha || !ref.key.startsWith(`u/${ownerId}/`)) {
    throw new AppError('media_invalid', 400, `${label} wasn't uploaded from this account`);
  }
  const pending = pendingKey(ref.key);
  let object = await env.MEDIA.get(pending);
  const isPending = object !== null;
  object ??= await env.MEDIA.get(ref.key);
  if (!object) {
    throw new AppError('media_invalid', 400, `${label} upload is missing; add the image again`);
  }
  const fail = async (message: string): Promise<never> => {
    if (isPending) await env.MEDIA.delete(pending);
    throw new AppError('media_invalid', 400, message);
  };
  if (object.size > UPLOAD_MAX_B[ref.kind] || object.httpMetadata?.contentType !== 'image/webp') {
    await object.body.cancel();
    return fail(
      `${label} must be a WebP image under ${Math.round(UPLOAD_MAX_B[ref.kind] / 1024)} KB`,
    );
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if ((await sha256Hex(bytes)) !== sha) return fail(`${label} upload was damaged; add it again`);
  const size = webpSize(bytes.subarray(0, WEBP_HEADER_BYTES));
  if (!size) return fail(`${label} isn't a readable WebP image`);
  const problem = dimensionProblem(ref.kind, size.w, size.h);
  if (problem) return fail(problem);
  return { ...ref, w: size.w, h: size.h };
}

/** Checks every object (in parallel). Throws `media_invalid` with the first problem found. */
export function verifyUploads(
  env: Env,
  ownerId: string,
  refs: readonly MediaRef[],
): Promise<VerifiedMedia[]> {
  return Promise.all(refs.map((ref) => verifyOne(env, ownerId, ref)));
}
