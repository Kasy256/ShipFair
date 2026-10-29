import * as z from 'zod';
import { isHttpsUrl } from '../url.ts';

const URL_MAX_CHARS = 2048;
const MEDIA_KEY_MAX_CHARS = 512;

export const Uuid = z.uuid();

/** Supabase returns `timestamptz` as e.g. `2026-10-26T09:30:00.123456+00:00`. */
export const Timestamp = z.iso.datetime({ offset: true });

export const Slug = z
  .string()
  .regex(/^[a-z0-9-]{3,40}$/, 'Use 3–40 lowercase letters, digits or dashes');

export const Handle = z
  .string()
  .regex(/^[a-z0-9_]{3,20}$/, 'Use 3–20 lowercase letters, digits or _');

export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb colour');

export const HttpsUrl = z
  .string()
  .max(URL_MAX_CHARS)
  .refine(isHttpsUrl, 'Use a full https:// link');

/** An R2 object key. Prefix rules (`u/<owner>/…`) are enforced by DB checks and the upload API. */
export const MediaKey = z
  .string()
  .min(1)
  .max(MEDIA_KEY_MAX_CHARS)
  // Path-safe characters only, no leading slash and no `..` segments.
  .regex(/^(?!\/)(?!.*\.\.)[A-Za-z0-9/_.-]+$/, 'Invalid media key');
