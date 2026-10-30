import {
  type AdminFlags,
  AdminUser,
  AdminUserDetail,
  FeatureFlags,
  FlagKey,
  LogEntry,
  LogFilter,
  type LogPage,
  type UserPage,
  UserSearchQuery,
} from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from '../env.ts';
import { AppError } from '../errors.ts';
import { serviceDb } from '../service.ts';
import { decodeCursor, inList, PAGE_FETCH, pageOf } from './paging.ts';
import { handles, REPORT_COLUMNS, ReportRow, toReports } from './reports.ts';

// GET /api/admin/users (search by handle), /users/:id (everything about one account),
// /log (the moderation log with filters) and /flags.

const USER_COLUMNS = 'id,handle,display_name,role,created_at';
const HISTORY_LIMIT = '50';

const UserRow = z.object({
  id: z.uuid(),
  handle: z.string(),
  display_name: z.string(),
  role: z.string(),
  created_at: z.string(),
});
const toUser = (row: z.infer<typeof UserRow>) =>
  AdminUser.parse({
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  });

const LogRow = z.object({
  id: z.int(),
  actor_id: z.uuid().nullable(),
  actor_handle: z.string().nullable(),
  action: z.string(),
  target_type: z.string(),
  target_id: z.string(),
  detail: z.record(z.string(), z.unknown()).catch({}),
  created_at: z.string(),
});
const toLog = (row: z.infer<typeof LogRow>) =>
  LogEntry.parse({
    id: row.id,
    actorId: row.actor_id,
    actorHandle: row.actor_handle,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: row.detail,
    createdAt: row.created_at,
  });

export async function searchUsers(
  env: Env,
  query: string | undefined,
  cursor: string | undefined,
): Promise<UserPage> {
  const q = UserSearchQuery.safeParse(query ?? '');
  if (!q.success) throw new AppError('bad_request', 400, 'Search by handle (a–z, 0–9 and _)');
  const after = decodeCursor(cursor, z.tuple([z.string()]));
  const conditions = [`handle.like.${q.data}*`, ...(after ? [`handle.gt.${after[0]}`] : [])];
  const rows = z
    .array(UserRow)
    .parse(
      await serviceDb(env).select(
        'profiles',
        { and: `(${conditions.join(',')})`, order: 'handle.asc', limit: PAGE_FETCH },
        USER_COLUMNS,
      ),
    );
  // `_` is a LIKE wildcard, so keep only real prefixes.
  const page = pageOf(rows, (r) => [r.handle]);
  return {
    items: page.rows.filter((r) => r.handle.startsWith(q.data)).map(toUser),
    nextCursor: page.nextCursor,
  };
}

const BanRow = z.object({
  reason: z.string(),
  until: z.string().nullable(),
  created_at: z.string(),
});
const UserBoothRow = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  approved_at: z.string().nullable(),
});

export async function userDetail(env: Env, userId: string): Promise<AdminUserDetail> {
  if (!z.uuid().safeParse(userId).success) throw new AppError('not_found', 404, 'No such user');
  const db = serviceDb(env);
  const [userRows, boothRows, banRows, byRows] = await Promise.all([
    db.select('profiles', { id: `eq.${userId}` }, USER_COLUMNS),
    db.select(
      'booths',
      { owner_id: `eq.${userId}`, order: 'created_at.desc' },
      'id,name,slug,status,approved_at',
    ),
    db.select('bans', { user_id: `eq.${userId}` }, 'reason,until,created_at'),
    db.select(
      'reports',
      { reporter_id: `eq.${userId}`, order: 'id.desc', limit: HISTORY_LIMIT },
      REPORT_COLUMNS,
    ),
  ]);
  const [user] = z.array(UserRow).parse(userRows);
  if (!user) throw new AppError('not_found', 404, 'No such user');
  const booths = z.array(UserBoothRow).parse(boothRows);
  const boothIds = booths.map((b) => b.id);
  const aboutThem = [`and(target_type.eq.user,target_id.eq.${userId})`];
  if (boothIds.length > 0)
    aboutThem.push(`and(target_type.eq.booth,target_id.${inList(boothIds)})`);
  const logTargets = [`actor_id.eq.${userId}`, `target_id.eq.${userId}`];
  if (boothIds.length > 0) {
    logTargets.push(`target_id.${inList(boothIds)}`, `detail->>boothId.${inList(boothIds)}`);
  }
  const [againstRows, logRows] = await Promise.all([
    db.select(
      'reports',
      { or: `(${aboutThem.join(',')})`, order: 'id.desc', limit: HISTORY_LIMIT },
      REPORT_COLUMNS,
    ),
    db.select('moderation_log', {
      or: `(${logTargets.join(',')})`,
      order: 'id.desc',
      limit: HISTORY_LIMIT,
    }),
  ]);
  const [ban] = z.array(BanRow).parse(banRows);
  return AdminUserDetail.parse({
    user: toUser(user),
    booths: booths.map((b) => ({ ...b, approvedAt: b.approved_at })),
    reportsBy: await toReports(db, z.array(ReportRow).parse(byRows)),
    reportsAgainst: await toReports(db, z.array(ReportRow).parse(againstRows)),
    ban: ban ? { reason: ban.reason, until: ban.until, createdAt: ban.created_at } : null,
    log: z.array(LogRow).parse(logRows).map(toLog),
  });
}

export async function moderationLog(
  env: Env,
  query: Record<string, string>,
  cursor: string | undefined,
): Promise<LogPage> {
  const filter = LogFilter.safeParse(query);
  if (!filter.success) throw new AppError('bad_request', 400, 'Check the log filters');
  const after = decodeCursor(cursor, z.tuple([z.int()]));
  const { action, targetType, targetId, actorId } = filter.data;
  const rows = z.array(LogRow).parse(
    await serviceDb(env).select('moderation_log', {
      order: 'id.desc',
      limit: PAGE_FETCH,
      ...(after ? { id: `lt.${after[0]}` } : {}),
      ...(action ? { action: `eq.${action}` } : {}),
      ...(targetType ? { target_type: `eq.${targetType}` } : {}),
      ...(targetId ? { target_id: `eq.${targetId}` } : {}),
      ...(actorId ? { actor_id: `eq.${actorId}` } : {}),
    }),
  );
  const page = pageOf(rows, (r) => [r.id]);
  return { items: page.rows.map(toLog), nextCursor: page.nextCursor };
}

const FlagRow = z.object({
  key: z.string(),
  value: z.unknown(),
  updated_at: z.string(),
  updated_by: z.uuid().nullable(),
});

export async function adminFlags(env: Env): Promise<AdminFlags> {
  const db = serviceDb(env);
  const rows = z
    .array(FlagRow)
    .parse(await db.select('flags', {}, 'key,value,updated_at,updated_by'));
  const known = rows.filter((r) => FlagKey.safeParse(r.key).success);
  const who = await handles(
    db,
    known.map((r) => r.updated_by),
  );
  return {
    flags: FeatureFlags.parse(Object.fromEntries(rows.map((r) => [r.key, r.value]))),
    updated: known.map((r) => ({
      key: FlagKey.parse(r.key),
      updatedAt: r.updated_at,
      updatedBy: r.updated_by ? (who.get(r.updated_by)?.handle ?? null) : null,
    })),
  };
}
