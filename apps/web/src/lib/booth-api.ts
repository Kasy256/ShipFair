import {
  ApiError,
  type BoothMedia,
  type BoothOwn,
  type BoothPricing,
  type BoothRevisionInput,
  boothSlugBase,
  type District,
  SubmitBoothResponse,
  SubmitRevisionResponse,
  type UploadKind,
  UploadSignResponse,
  UrlCheckResponse,
} from '@shipfair/shared';
import * as z from 'zod';
import { BOOTH_OWN_COLUMNS, boothOwnFromRow, DistrictFromRow, REVISION_OWN_COLUMNS } from './db.ts';
import type { PreparedImage } from './images.ts';
import type { Supabase } from './supabase.ts';

// Booth submission from the browser (ARCHITECTURE.md §8): drafts are written with supabase-js
// under RLS; uploads, the URL check, submit and revisions go through `/api`, which re-checks all.

/** Server error codes (worker/errors.ts) plus the client's own. `ui/errors.ts` words them. */
export type BoothErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'too_large'
  | 'turnstile_failed'
  | 'account_too_new'
  | 'limit_pending'
  | 'limit_total'
  | 'not_submittable'
  | 'logo_missing'
  | 'media_invalid'
  | 'upload_invalid'
  | 'unavailable'
  | 'booth_limit'
  | 'no_permission'
  | 'network';

export class BoothApiError extends Error {
  readonly code: BoothErrorCode;

  /** `message` is the server's, safe to show for `media_invalid` and `bad_request` (specific). */
  constructor(code: BoothErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BoothApiError';
    this.code = code;
  }
}

const KNOWN_CODES = new Set<string>([
  'unauthorized',
  'forbidden',
  'not_found',
  'bad_request',
  'rate_limited',
  'too_large',
  'turnstile_failed',
  'account_too_new',
  'limit_pending',
  'limit_total',
  'not_submittable',
  'logo_missing',
  'media_invalid',
  'upload_invalid',
  'unavailable',
] satisfies BoothErrorCode[]);

async function postApi<T>(
  path: string,
  token: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new BoothApiError('network', 'Could not reach the server', { cause: error });
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return schema.parse(json);
  const error = ApiError.safeParse(json);
  const code =
    error.success && KNOWN_CODES.has(error.data.error.code) ? error.data.error.code : null;
  throw new BoothApiError(
    (code as BoothErrorCode | null) ?? 'network',
    error.success ? error.data.error.message : `Request failed (${res.status})`,
  );
}

/** Signs and uploads a prepared image (skipped when the same bytes are already up). */
export async function uploadImage(
  token: string,
  kind: UploadKind,
  image: PreparedImage,
): Promise<string> {
  const signed = await postApi(
    '/api/uploads/sign',
    token,
    { kind, contentType: 'image/webp', bytes: image.bytes, sha256: image.sha256 },
    UploadSignResponse,
  );
  if (!signed.isNeeded) return signed.key;
  let res: Response;
  try {
    res = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: image.blob });
  } catch (error) {
    throw new BoothApiError('network', 'The upload did not go through', { cause: error });
  }
  if (!res.ok) throw new BoothApiError('upload_invalid', `Upload failed (${res.status})`);
  return signed.key;
}

export function checkBoothUrl(token: string, url: string) {
  return postApi('/api/booths/check-url', token, { url }, UrlCheckResponse);
}

export function submitBooth(token: string, boothId: string, turnstileToken: string) {
  return postApi(`/api/booths/${boothId}/submit`, token, { turnstileToken }, SubmitBoothResponse);
}

export function submitRevision(
  token: string,
  boothId: string,
  revision: BoothRevisionInput,
  turnstileToken: string,
) {
  return postApi(
    `/api/booths/${boothId}/revision`,
    token,
    { revision, turnstileToken },
    SubmitRevisionResponse,
  );
}

/** What the form autosaves. Only valid drafts are saved: the table's checks need the basics. */
export interface DraftFields {
  readonly name: string;
  readonly tagline: string;
  readonly url: string;
  readonly districtId: number;
  readonly pricing: BoothPricing | undefined;
  readonly description: string | undefined;
  readonly logoKey: string | undefined;
  readonly media: readonly BoothMedia[];
}

interface PostgrestLikeError {
  code?: string;
  hint?: string | null;
  message: string;
}

function fromDbError(error: PostgrestLikeError): BoothApiError {
  if (error.hint === 'booth_limit') return new BoothApiError('booth_limit', error.message);
  if (error.code === '42501') return new BoothApiError('no_permission', error.message);
  return new BoothApiError('network', error.message, { cause: error });
}

const SLUG_RACE_RETRIES = 2;

/** Inserts or updates the draft; returns its id and current slug (the DB may suffix it). */
export async function saveDraft(
  client: Supabase,
  userId: string,
  boothId: string | null,
  fields: DraftFields,
): Promise<{ id: string; slug: string }> {
  const row = {
    slug: boothSlugBase(fields.name),
    name: fields.name,
    tagline: fields.tagline,
    url: fields.url,
    district_id: fields.districtId,
    pricing: fields.pricing ?? null,
    description: fields.description || null,
    logo_key: fields.logoKey ?? null,
    media: [...fields.media],
  };
  for (let attempt = 0; ; attempt++) {
    const { data, error } = boothId
      ? await client.from('booths').update(row).eq('id', boothId).select('id,slug').single()
      : await client
          .from('booths')
          .insert({ ...row, owner_id: userId })
          .select('id,slug')
          .single();
    // Two drafts racing for one slug: the trigger picks a free one on retry.
    if (error?.code === '23505' && attempt < SLUG_RACE_RETRIES) continue;
    if (error) throw fromDbError(error);
    return data;
  }
}

/** The signed-in maker's booths, newest first, each with its latest revision. */
export async function fetchMyBooths(client: Supabase, userId: string): Promise<BoothOwn[]> {
  const [booths, revisions] = await Promise.all([
    client
      .from('booths')
      .select(BOOTH_OWN_COLUMNS.join(','))
      .eq('owner_id', userId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false }),
    client
      .from('booth_revisions')
      .select(REVISION_OWN_COLUMNS.join(','))
      .eq('owner_id', userId)
      .order('created_at', { ascending: false }),
  ]);
  if (booths.error) throw fromDbError(booths.error);
  if (revisions.error) throw fromDbError(revisions.error);
  const revisionRows = z.array(z.looseObject({ booth_id: z.string() })).parse(revisions.data);
  return z
    .array(z.looseObject({ id: z.string() }))
    .parse(booths.data)
    .map((row) => boothOwnFromRow(row, revisionRows.find((r) => r.booth_id === row.id) ?? null));
}

/** Districts for the form's picker, in city order (public read). */
export async function fetchDistricts(client: Supabase): Promise<District[]> {
  const { data, error } = await client.from('districts').select('*').order('sort_order');
  if (error) throw fromDbError(error);
  return data.map((row) => DistrictFromRow.parse(row));
}
