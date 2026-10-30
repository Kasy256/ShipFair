import {
  type AdminActionResponse,
  BanRequest,
  BoothStatus,
  FlagUpdate,
  HideRequest,
  RejectRequest,
  ReportStatusRequest,
  rejectReasonText,
  UnbanRequest,
} from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from '../env.ts';
import { AppError } from '../errors.ts';
import { forgetFlags } from '../flags.ts';
import { publishMedia } from '../media-publish.ts';
import { type ServiceDb, serviceDb } from '../service.ts';
import { bumpWorldVersion } from '../world.ts';
import type { Staff } from './staff.ts';

// POST /api/admin/* (prompt 09). Each change goes through `admin_action` (one transaction with
// its moderation_log row). Approvals first copy media from `pending/` to the public prefix, and
// anything that changes the city bumps the world cache version and tells the realtime Worker.

export interface AdminContext {
  readonly env: Env;
  readonly staff: Staff;
}

type AdminAction =
  | 'approve_booth'
  | 'approve_revision'
  | 'reject_booth'
  | 'reject_revision'
  | 'hide_booth'
  | 'hide_guestbook'
  | 'ban'
  | 'unban'
  | 'report_status'
  | 'set_flag';

function adminAction(
  ctx: AdminContext,
  db: ServiceDb,
  action: AdminAction,
  targetId: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  return db.rpc('admin_action', {
    actor: ctx.staff.userId,
    action,
    target_id: targetId,
    payload,
  });
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new AppError('bad_request', 400, issue?.message ?? 'Check the request');
}

const MediaColumns = {
  logo_key: z.string().nullable(),
  media: z.array(z.object({ key: z.string() })).catch([]),
};
const BoothRow = z.object({ id: z.uuid(), status: BoothStatus, ...MediaColumns });
const RevisionRow = z.object({ id: z.uuid(), ...MediaColumns });

const mediaKeys = (row: { logo_key: string | null; media: { key: string }[] }) =>
  [row.logo_key, ...row.media.map((m) => m.key)].filter((k): k is string => k !== null);

/** What `:id` points at: a pending booth, or a live booth with a pending edit. */
async function reviewTarget(db: ServiceDb, boothId: string) {
  if (!z.uuid().safeParse(boothId).success) throw new AppError('not_found', 404, 'No such booth');
  const [booth] = z
    .array(BoothRow)
    .parse(await db.select('booths', { id: `eq.${boothId}` }, 'id,status,logo_key,media'));
  if (!booth) throw new AppError('not_found', 404, 'No such booth');
  if (booth.status === 'pending') return { kind: 'booth', booth } as const;
  if (booth.status === 'approved') {
    const [revision] = z
      .array(RevisionRow)
      .parse(
        await db.select(
          'booth_revisions',
          { booth_id: `eq.${boothId}`, status: 'eq.pending' },
          'id,logo_key,media',
        ),
      );
    if (revision) return { kind: 'revision', booth, revision } as const;
  }
  throw new AppError('not_actionable', 409, `This booth is ${booth.status} with nothing to review`);
}

/** Bumps the world cache and tells the realtime Worker. Realtime being down never fails a change. */
async function cityChanged(env: Env, boothIds: readonly string[]): Promise<number> {
  const worldVersion = await bumpWorldVersion(env.KV);
  try {
    await env.REALTIME.worldUpdate(boothIds);
  } catch (error) {
    console.error('admin: realtime worldUpdate failed', error);
  }
  return worldVersion;
}

export async function approveBooth(
  ctx: AdminContext,
  boothId: string,
): Promise<AdminActionResponse> {
  const db = serviceDb(ctx.env);
  const target = await reviewTarget(db, boothId);
  // Media first: a booth must never go live pointing at objects nobody can fetch.
  if (target.kind === 'booth') {
    const missingMedia = await publishMedia(ctx.env, mediaKeys(target.booth));
    await adminAction(ctx, db, 'approve_booth', boothId, { missingMedia });
  } else {
    const missingMedia = await publishMedia(ctx.env, mediaKeys(target.revision));
    await adminAction(ctx, db, 'approve_revision', target.revision.id, { missingMedia });
  }
  return { ok: true, worldVersion: await cityChanged(ctx.env, [boothId]) };
}

export async function rejectBooth(
  ctx: AdminContext,
  boothId: string,
  body: unknown,
): Promise<AdminActionResponse> {
  const { reason, note } = parseBody(RejectRequest, body);
  const db = serviceDb(ctx.env);
  const target = await reviewTarget(db, boothId);
  const payload = { reason, note: note ?? null, reasonText: rejectReasonText(reason, note) };
  if (target.kind === 'booth') await adminAction(ctx, db, 'reject_booth', boothId, payload);
  else await adminAction(ctx, db, 'reject_revision', target.revision.id, payload);
  return { ok: true };
}

export async function hide(ctx: AdminContext, body: unknown): Promise<AdminActionResponse> {
  const { targetType, targetId, hidden } = parseBody(HideRequest, body);
  const db = serviceDb(ctx.env);
  if (targetType === 'guestbook') {
    await adminAction(ctx, db, 'hide_guestbook', targetId, { hidden });
    return { ok: true };
  }
  await adminAction(ctx, db, 'hide_booth', targetId, { hidden });
  return { ok: true, worldVersion: await cityChanged(ctx.env, [targetId]) };
}

export async function ban(ctx: AdminContext, body: unknown): Promise<AdminActionResponse> {
  const { userId, reason, until } = parseBody(BanRequest, body);
  if (until && Date.parse(until) <= Date.now()) {
    throw new AppError('bad_request', 400, 'A ban has to end in the future');
  }
  if (userId === ctx.staff.userId)
    throw new AppError('not_actionable', 409, "You can't ban yourself");
  await adminAction(ctx, serviceDb(ctx.env), 'ban', userId, { reason, until: until ?? null });
  // Bans take effect at once (TRUST_AND_SAFETY.md): close their sockets. `hello` checks too.
  try {
    await ctx.env.REALTIME.kick(userId, 'banned');
  } catch (error) {
    console.error('admin: realtime kick failed', error);
  }
  return { ok: true };
}

export async function unban(ctx: AdminContext, body: unknown): Promise<AdminActionResponse> {
  const { userId } = parseBody(UnbanRequest, body);
  await adminAction(ctx, serviceDb(ctx.env), 'unban', userId);
  return { ok: true };
}

export async function setReportStatus(
  ctx: AdminContext,
  reportId: string,
  body: unknown,
): Promise<AdminActionResponse> {
  if (!/^[1-9][0-9]{0,18}$/.test(reportId)) throw new AppError('not_found', 404, 'No such report');
  const { status } = parseBody(ReportStatusRequest, body);
  await adminAction(ctx, serviceDb(ctx.env), 'report_status', reportId, { status });
  return { ok: true };
}

export async function setFlag(ctx: AdminContext, body: unknown): Promise<AdminActionResponse> {
  const { key, value } = parseBody(FlagUpdate, body);
  await adminAction(ctx, serviceDb(ctx.env), 'set_flag', key, { value });
  forgetFlags();
  return { ok: true };
}
