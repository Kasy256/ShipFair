import {
  BOOTHS_PER_USER_MAX,
  BoothDraftInput,
  type BoothMedia,
  BoothStatus,
  type FeatureFlags,
  PENDING_BOOTHS_PER_USER_MAX,
  type PrescreenResult,
  SubmitBoothRequest,
  type SubmitBoothResponse,
  SubmitRevisionRequest,
  type SubmitRevisionResponse,
  Timestamp,
  UrlCheckRequest,
  type UrlCheckResponse,
} from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';
import { readFlags } from './flags.ts';
import { type MediaRef, type VerifiedMedia, verifyUploads } from './media-check.ts';
import { defaultChecks, type PrescreenCheck, prescreen } from './moderation/prescreen.ts';
import { checkUrl } from './moderation/url-check.ts';
import { type ServiceDb, serviceDb } from './service.ts';
import { verifyTurnstile } from './turnstile.ts';

// POST /api/booths/:id/submit and /api/booths/:id/revision (prompt 08). The browser wrote the
// draft under RLS; here the Worker re-checks everything with the service role: owner, Turnstile,
// the limits in TRUST_AND_SAFETY.md, the booth fields, the uploaded objects, then the pre-screen.

const MS_PER_MINUTE = 60_000;

const BoothRow = z.object({
  id: z.uuid(),
  owner_id: z.uuid(),
  status: BoothStatus,
  slug: z.string(),
  name: z.string(),
  tagline: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  district_id: z.int(),
  logo_key: z.string().nullable(),
  media: z.unknown(),
  pricing: z.string().nullable(),
});
type BoothRow = z.infer<typeof BoothRow>;

const ProfileAge = z.array(z.object({ created_at: Timestamp })).max(1);
const OwnerBooths = z.array(z.object({ id: z.uuid(), status: BoothStatus }));
const RevisionIds = z.array(z.object({ id: z.uuid() }));

export interface SubmitContext {
  readonly env: Env;
  readonly userId: string;
  readonly remoteIp: string | undefined;
  /** Pre-screen checks; tests pass fakes. */
  readonly checks?: readonly PrescreenCheck[];
}

/** The booth, if the caller owns it. Someone else's booth is "not found", like a missing one. */
async function ownBooth(db: ServiceDb, boothId: string, userId: string): Promise<BoothRow> {
  if (!z.uuid().safeParse(boothId).success) throw new AppError('not_found', 404, 'No such booth');
  const rows = await db.select('booths', { id: `eq.${boothId}` });
  const booth = BoothRow.safeParse(rows[0]);
  if (!booth.success || booth.data.owner_id !== userId) {
    throw new AppError('not_found', 404, 'No such booth');
  }
  return booth.data;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Check the booth details';
  const field = issue.path.join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}

/** The `SUBMISSIONS_OPEN` flag: staff can pause submissions and edits (INFRASTRUCTURE.md §10). */
async function openFlags(env: Env): Promise<FeatureFlags> {
  const flags = await readFlags(env);
  if (!flags.SUBMISSIONS_OPEN) {
    throw new AppError(
      'submissions_paused',
      503,
      'Submissions are paused for a little while; your draft is saved',
    );
  }
  return flags;
}

/** TRUST_AND_SAFETY.md "Limits": account age (flag), 1 pending, 3 in total. */
async function checkLimits(flags: FeatureFlags, db: ServiceDb, userId: string, boothId: string) {
  const minAge = flags.MIN_ACCOUNT_AGE_MINUTES;
  const profile = ProfileAge.parse(
    await db.select('profiles', { id: `eq.${userId}` }, 'created_at'),
  );
  const createdAt = profile[0]?.created_at;
  if (!createdAt) throw new AppError('not_found', 404, 'This account no longer exists');
  const ageMinutes = (Date.now() - Date.parse(createdAt)) / MS_PER_MINUTE;
  if (ageMinutes < minAge) {
    throw new AppError(
      'account_too_new',
      403,
      `New accounts can submit after ${minAge} minutes; try again in ${Math.ceil(minAge - ageMinutes)}`,
    );
  }
  const booths = OwnerBooths.parse(
    await db.select('booths', { owner_id: `eq.${userId}` }, 'id,status'),
  );
  const others = booths.filter((b) => b.id !== boothId);
  if (others.filter((b) => b.status === 'pending').length >= PENDING_BOOTHS_PER_USER_MAX) {
    throw new AppError('limit_pending', 409, 'You already have a booth in review');
  }
  if (others.filter((b) => b.status !== 'archived').length >= BOOTHS_PER_USER_MAX) {
    throw new AppError('limit_total', 409, `Makers can have ${BOOTHS_PER_USER_MAX} booths for now`);
  }
}

function mediaRefs(logoKey: string, media: readonly BoothMedia[]): MediaRef[] {
  if (media.some((m) => m.type !== 'image')) {
    throw new AppError('media_invalid', 400, "Videos aren't supported yet; use screenshots");
  }
  return [
    { key: logoKey, kind: 'logo' },
    ...media.map((m): MediaRef => ({ key: m.key, kind: 'screenshot' })),
  ];
}

/** Stored media with the real sizes read from the files, not the ones the client claimed. */
const withRealSizes = (verified: readonly VerifiedMedia[]): BoothMedia[] =>
  verified
    .filter((v) => v.kind === 'screenshot')
    .map((v) => ({ type: 'image', key: v.key, w: v.w, h: v.h }));

async function logPrescreen(
  db: ServiceDb,
  target: { type: 'booth' | 'booth_revision'; id: string },
  userId: string,
  result: PrescreenResult,
): Promise<void> {
  // actor_id null: the pre-screen is the system, not a person (ARCHITECTURE.md §5).
  await db.insert('moderation_log', {
    actor_id: null,
    action: 'prescreen',
    target_type: target.type,
    target_id: target.id,
    detail: { ...result, submittedBy: userId },
  });
}

export async function submitBooth(
  ctx: SubmitContext,
  boothId: string,
  body: unknown,
): Promise<SubmitBoothResponse> {
  const request = SubmitBoothRequest.safeParse(body);
  if (!request.success) throw new AppError('bad_request', 400, 'Complete the bot check first');
  const flags = await openFlags(ctx.env);
  const db = serviceDb(ctx.env);
  const booth = await ownBooth(db, boothId, ctx.userId);
  if (booth.status !== 'draft' && booth.status !== 'rejected') {
    throw new AppError('not_submittable', 409, `This booth is ${booth.status}, not a draft`);
  }
  await verifyTurnstile(ctx.env, request.data.turnstileToken, ctx.remoteIp);
  await checkLimits(flags, db, ctx.userId, booth.id);

  const draft = BoothDraftInput.safeParse({
    slug: booth.slug,
    name: booth.name,
    tagline: booth.tagline,
    description: booth.description ?? undefined,
    url: booth.url,
    districtId: booth.district_id,
    logoKey: booth.logo_key ?? undefined,
    media: booth.media,
    pricing: booth.pricing ?? undefined,
  });
  if (!draft.success) throw new AppError('bad_request', 400, firstIssue(draft.error));
  const { logoKey, media } = draft.data;
  if (!logoKey) throw new AppError('logo_missing', 400, 'Add a logo before submitting');

  const verified = await verifyUploads(ctx.env, ctx.userId, mediaRefs(logoKey, media));
  const result = await prescreen(
    { ...draft.data, description: draft.data.description ?? null, images: verified },
    ctx.checks ?? defaultChecks(ctx.env),
  );
  // Only from draft/rejected, so a race with another submit (or staff) can't be overwritten.
  const updated = await db.update(
    'booths',
    { id: `eq.${booth.id}`, status: 'in.(draft,rejected)' },
    { status: 'pending', reject_reason: null, media: withRealSizes(verified) },
  );
  if (updated.length === 0) throw new AppError('not_submittable', 409, 'This booth just changed');
  await logPrescreen(db, { type: 'booth', id: booth.id }, ctx.userId, result);
  return { status: 'pending', prescreen: result };
}

export async function submitRevision(
  ctx: SubmitContext,
  boothId: string,
  body: unknown,
): Promise<SubmitRevisionResponse> {
  const request = SubmitRevisionRequest.safeParse(body);
  if (!request.success) throw new AppError('bad_request', 400, firstIssue(request.error));
  await openFlags(ctx.env);
  const db = serviceDb(ctx.env);
  const booth = await ownBooth(db, boothId, ctx.userId);
  if (booth.status !== 'approved') {
    throw new AppError('not_submittable', 409, 'Only live booths take edits for review');
  }
  await verifyTurnstile(ctx.env, request.data.turnstileToken, ctx.remoteIp);

  const revision = request.data.revision;
  const verified = await verifyUploads(
    ctx.env,
    ctx.userId,
    mediaRefs(revision.logoKey, revision.media),
  );
  const result = await prescreen(
    { ...revision, name: booth.name, description: revision.description ?? null, images: verified },
    ctx.checks ?? defaultChecks(ctx.env),
  );
  const values = {
    tagline: revision.tagline,
    description: revision.description ?? null,
    url: revision.url,
    logo_key: revision.logoKey,
    media: withRealSizes(verified),
  };
  // One open revision per booth: a second edit replaces the pending one.
  const open = RevisionIds.parse(
    await db.select('booth_revisions', { booth_id: `eq.${booth.id}`, status: 'eq.pending' }, 'id'),
  );
  const written = RevisionIds.parse(
    open[0]
      ? await db.update('booth_revisions', { id: `eq.${open[0].id}` }, values)
      : await db.insert('booth_revisions', {
          ...values,
          booth_id: booth.id,
          owner_id: ctx.userId,
        }),
  );
  const revisionId = written[0]?.id;
  if (!revisionId) throw new AppError('unavailable', 503, 'The edit was not saved');
  await logPrescreen(db, { type: 'booth_revision', id: revisionId }, ctx.userId, result);
  return { revisionId, status: 'pending', prescreen: result };
}

/** POST /api/booths/check-url: the form's live "We couldn't reach this URL" hint. */
export async function checkBoothUrl(body: unknown): Promise<UrlCheckResponse> {
  const request = UrlCheckRequest.safeParse(body);
  if (!request.success) throw new AppError('bad_request', 400, 'Use a full https:// link');
  const { isReachable, finalUrl } = await checkUrl(request.data.url);
  return { isReachable, finalUrl };
}
