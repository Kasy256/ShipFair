import { AdminReport, ReportGroup, type ReportPage } from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from '../env.ts';
import { type ServiceDb, serviceDb } from '../service.ts';
import { afterFilter, decodeCursor, inList, orderParam, PAGE_FETCH, pageOf } from './paging.ts';

// GET /api/admin/reports: open reports grouped by target (view `admin_report_targets`), the most
// reported first, then the longest waiting. Each group carries what was reported: the booth, the
// guestbook entry, or the user. Chat lines arrive with `reports.context` in prompt 12.

const SORT = [
  { column: 'open_reports', isDesc: true },
  { column: 'first_at' },
  { column: 'target_type' },
  { column: 'target_id' },
] as const;
const Cursor = z.tuple([z.int(), z.string(), z.string(), z.string()]);

const TargetRow = z.object({
  target_type: z.string(),
  target_id: z.string(),
  open_reports: z.int(),
  reporters: z.int(),
  first_at: z.string(),
});

export const REPORT_COLUMNS = 'id,reporter_id,target_type,target_id,reason,note,status,created_at';
export const ReportRow = z.object({
  id: z.int(),
  reporter_id: z.uuid().nullable(),
  target_type: z.string(),
  target_id: z.string(),
  reason: z.string(),
  note: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
});
export type ReportRow = z.infer<typeof ReportRow>;

const HandleRow = z.object({ id: z.uuid(), handle: z.string() });
const BoothRow = z.object({
  id: z.uuid(),
  owner_id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  tagline: z.string(),
  url: z.string(),
  logo_key: z.string().nullable(),
});
const EntryRow = z.object({
  id: z.int(),
  booth_id: z.uuid(),
  author_id: z.uuid(),
  body: z.string(),
  hidden: z.boolean(),
});

/** id → `{ id, handle }` for the given profile ids (null ids are skipped). */
export async function handles(db: ServiceDb, ids: Iterable<string | null>) {
  const unique = [...new Set([...ids].filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map<string, { id: string; handle: string }>();
  const rows = z
    .array(HandleRow)
    .parse(await db.select('profiles', { id: inList(unique) }, 'id,handle'));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Report rows as the admin API shows them (reporters resolved to handles). */
export async function toReports(db: ServiceDb, rows: readonly ReportRow[]): Promise<AdminReport[]> {
  const who = await handles(
    db,
    rows.map((r) => r.reporter_id),
  );
  return z.array(AdminReport).parse(
    rows.map((r) => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: r.created_at,
      reporter: r.reporter_id ? (who.get(r.reporter_id) ?? null) : null,
    })),
  );
}

const idsOf = (rows: readonly z.infer<typeof TargetRow>[], type: string) =>
  rows.filter((r) => r.target_type === type).map((r) => r.target_id);

export async function reportInbox(env: Env, cursor: string | undefined): Promise<ReportPage> {
  const after = decodeCursor(cursor, Cursor);
  const db = serviceDb(env);
  const targets = z.array(TargetRow).parse(
    await db.select('admin_report_targets', {
      order: orderParam(SORT),
      limit: PAGE_FETCH,
      ...(after ? { or: afterFilter(SORT, after) } : {}),
    }),
  );
  const page = pageOf(targets, (t) => [t.open_reports, t.first_at, t.target_type, t.target_id]);
  if (page.rows.length === 0) return { items: [], nextCursor: null };

  const boothIds = idsOf(page.rows, 'booth');
  const entryIds = idsOf(page.rows, 'guestbook').filter((id) => /^[0-9]{1,19}$/.test(id));
  const [reportRows, boothRows, entryRows] = await Promise.all([
    db.select(
      'reports',
      {
        status: 'eq.open',
        target_id: inList(page.rows.map((t) => t.target_id)),
        order: 'id.asc',
      },
      REPORT_COLUMNS,
    ),
    boothIds.length > 0 ? db.select('booths', { id: inList(boothIds) }) : Promise.resolve([]),
    entryIds.length > 0
      ? db.select('guestbook_entries', { id: inList(entryIds) })
      : Promise.resolve([]),
  ]);
  const reports = await toReports(db, z.array(ReportRow).parse(reportRows));
  const booths = z.array(z.looseObject(BoothRow.shape)).parse(boothRows);
  const entries = z.array(z.looseObject(EntryRow.shape)).parse(entryRows);
  const who = await handles(db, [
    ...booths.map((b) => b.owner_id),
    ...entries.map((e) => e.author_id),
    ...idsOf(page.rows, 'user'),
  ]);

  const items: ReportGroup[] = [];
  for (const target of page.rows) {
    const booth =
      target.target_type === 'booth' ? booths.find((b) => b.id === target.target_id) : undefined;
    const entry =
      target.target_type === 'guestbook'
        ? entries.find((e) => String(e.id) === target.target_id)
        : undefined;
    const group = ReportGroup.safeParse({
      targetType: target.target_type,
      targetId: target.target_id,
      openReports: target.open_reports,
      reporters: target.reporters,
      firstAt: target.first_at,
      reports: reports.filter(
        (r) => r.targetType === target.target_type && r.targetId === target.target_id,
      ),
      booth: booth
        ? {
            id: booth.id,
            name: booth.name,
            slug: booth.slug,
            status: booth.status,
            tagline: booth.tagline,
            url: booth.url,
            logoKey: booth.logo_key,
            owner: who.get(booth.owner_id) ?? null,
          }
        : null,
      guestbook: entry
        ? {
            id: String(entry.id),
            body: entry.body,
            hidden: entry.hidden,
            boothId: entry.booth_id,
            author: who.get(entry.author_id) ?? null,
          }
        : null,
      user: target.target_type === 'user' ? (who.get(target.target_id) ?? null) : null,
    });
    if (group.success) items.push(group.data);
    else console.error(`admin reports: dropped ${target.target_type} ${target.target_id}`);
  }
  return { items, nextCursor: page.nextCursor };
}
