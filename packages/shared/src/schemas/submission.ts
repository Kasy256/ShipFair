import * as z from 'zod';
import { UPLOAD_LOGO_MAX_B, UPLOAD_SCREENSHOT_MAX_B } from '../constants.ts';
import { BoothDraftInput } from './booth.ts';
import { HttpsUrl, MediaKey, Uuid } from './common.ts';

// Booth submission (prompt 08): uploads, submit, revisions, the URL check (ARCHITECTURE.md §6).

export const UploadKind = z.enum(['logo', 'screenshot']);
export type UploadKind = z.infer<typeof UploadKind>;

/** Largest WebP the sign endpoint accepts per kind (after the browser re-encodes it). */
export const UPLOAD_MAX_B: Readonly<Record<UploadKind, number>> = {
  logo: UPLOAD_LOGO_MAX_B,
  screenshot: UPLOAD_SCREENSHOT_MAX_B,
};

/** Lowercase hex sha256 of the bytes to upload; it names the object, so uploads dedupe. */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'Use a lowercase hex sha256');

/** POST /api/uploads/sign */
export const UploadSignRequest = z.object({
  kind: UploadKind,
  contentType: z.literal('image/webp'),
  bytes: z.int().positive(),
  sha256: Sha256Hex,
});
export type UploadSignRequest = z.infer<typeof UploadSignRequest>;

export const UploadSignResponse = z.object({
  /** `u/<userId>/<sha256>.webp`: what the booth stores. The object lands under `pending/`. */
  key: MediaKey,
  /** Presigned PUT URL (R2), or the Worker's local upload route in development. Empty when not needed. */
  url: z.string(),
  /** Send exactly these headers with the PUT; they are part of the signature. */
  headers: z.record(z.string(), z.string()),
  /** False when an identical object is already uploaded: skip the PUT. */
  isNeeded: z.boolean(),
});
export type UploadSignResponse = z.infer<typeof UploadSignResponse>;

/** The object key for an upload. Pure, so the client and the Worker agree on it. */
export function uploadKey(userId: string, sha256: string): string {
  return `u/${userId}/${sha256}.webp`;
}

/** The sha256 a content-addressed key claims (`u/<owner>/<sha>.webp`), or null. */
export function keySha256(key: string): string | null {
  return key.match(/^u\/[0-9a-f-]{36}\/([0-9a-f]{64})\.webp$/)?.[1] ?? null;
}

const TurnstileToken = z.string().min(1).max(2048);

/** POST /api/booths/:id/submit */
export const SubmitBoothRequest = z.object({ turnstileToken: TurnstileToken });
export type SubmitBoothRequest = z.infer<typeof SubmitBoothRequest>;

export const PrescreenFlag = z.enum([
  'url_unreachable',
  'url_not_https',
  'url_blocklisted',
  'url_unsafe',
  'text_flagged',
  'text_unchecked',
  'image_invalid',
  'safe_browsing_unchecked',
]);
export type PrescreenFlag = z.infer<typeof PrescreenFlag>;

/** Stored in `moderation_log.detail`; the review queue sorts by `score` (0 is clean). */
export const PrescreenResult = z.object({
  score: z.number().min(0),
  flags: z.array(PrescreenFlag),
  /** Where the booth URL ended up after redirects (null when it couldn't be fetched). */
  finalUrl: HttpsUrl.nullable(),
});
export type PrescreenResult = z.infer<typeof PrescreenResult>;

export const SubmitBoothResponse = z.object({
  status: z.literal('pending'),
  prescreen: PrescreenResult,
});
export type SubmitBoothResponse = z.infer<typeof SubmitBoothResponse>;

/**
 * An edit to a live booth (prompt 08 §7): only these fields, applied when staff approve it. The
 * booth itself stays as it is until then.
 */
export const BoothRevisionInput = BoothDraftInput.pick({
  tagline: true,
  description: true,
  url: true,
  logoKey: true,
  media: true,
}).extend({ logoKey: MediaKey });
export type BoothRevisionInput = z.infer<typeof BoothRevisionInput>;

/** POST /api/booths/:id/revision */
export const SubmitRevisionRequest = z.object({
  revision: BoothRevisionInput,
  turnstileToken: TurnstileToken,
});
export type SubmitRevisionRequest = z.infer<typeof SubmitRevisionRequest>;

export const SubmitRevisionResponse = z.object({
  revisionId: Uuid,
  status: z.literal('pending'),
  prescreen: PrescreenResult,
});
export type SubmitRevisionResponse = z.infer<typeof SubmitRevisionResponse>;

/** POST /api/booths/check-url: the form's "We couldn't reach this URL" hint. */
export const UrlCheckRequest = z.object({ url: HttpsUrl });
export type UrlCheckRequest = z.infer<typeof UrlCheckRequest>;

export const UrlCheckResponse = z.object({
  isReachable: z.boolean(),
  finalUrl: HttpsUrl.nullable(),
});
export type UrlCheckResponse = z.infer<typeof UrlCheckResponse>;
