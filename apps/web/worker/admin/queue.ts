import { HttpsUrl, QueueItem, QueueKind, type QueuePage } from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from '../env.ts';
import { type ServiceDb, serviceDb } from '../service.ts';
import { afterFilter, decodeCursor, inList, orderParam, PAGE_FETCH, pageOf } from './paging.ts';

// GET /api/admin/queue: pending booths and pending edits, clean pre-screens first, then oldest
// (view `admin_review_queue`). Each card carries the content to review and the maker's context.

const SORT = [{ column: 'score' }, { column: 'submitted_at' }, { column: 'id' }] as const;
const Cursor = z.tuple([z.number(), z.string(), z.uuid()]);

const QueueRow = z.object({
  kind: QueueKind,
  id: z.uuid(),
  booth_id: z.uuid(),
  owner_id: z.uuid(),
  submitted_at: z.string(),
  score: z.coerce.number(),
  flags: z.array(z.string()).catch([]),
  final_url: z.string().nullable(),
});
type QueueRow = z.infer<typeof QueueRow>;

const Content = z.looseObject({
  id: z.uuid(),
  tagline: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  logo_key: z.string().nullable(),
  media: z.unknown(),
});
const BoothRow = Content.extend({
  owner_id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  district_id: z.int(),
  pricing: z.string().nullable(),
});
const MakerRow = z.object({
  id: z.uuid(),
  handle: z.string(),
  display_name: z.string(),
  created_at: z.string(),
});

const byId = <T extends { id: string }>(rows: readonly T[]) => new Map(rows.map((r) => [r.id, r]));

async function cardsFor(db: ServiceDb, rows: readonly QueueRow[]): Promise<QueueItem[]> {
  if (rows.length === 0) return [];
  const owners = [...new Set(rows.map((r) => r.owner_id))];
  const revisionIds = rows.filter((r) => r.kind === 'revision').map((r) => r.id);
  const [booths, revisions, makers] = await Promise.all([
    db.select('booths', { owner_id: inList(owners), status: 'neq.archived' }),
    revisionIds.length > 0
      ? db.select('booth_revisions', { id: inList(revisionIds) })
      : Promise.resolve([]),
    db.select('profiles', { id: inList(owners) }, 'id,handle,display_name,created_at'),
  ]);
  const boothRows = z.array(BoothRow).parse(booths);
  const boothById = byId(boothRows);
  const revisionById = byId(z.array(Content).parse(revisions));
  const makerById = byId(z.array(MakerRow).parse(makers));

  const items: QueueItem[] = [];
  for (const row of rows) {
    const booth = boothById.get(row.booth_id);
    const maker = makerById.get(row.owner_id);
    const content = row.kind === 'revision' ? revisionById.get(row.id) : booth;
    if (!booth || !maker || !content) continue;
    const item = QueueItem.safeParse({
      kind: row.kind,
      id: row.id,
      boothId: booth.id,
      name: booth.name,
      slug: booth.slug,
      tagline: content.tagline,
      description: content.description,
      url: content.url,
      finalUrl: HttpsUrl.safeParse(row.final_url).success ? row.final_url : null,
      districtId: booth.district_id,
      pricing: booth.pricing,
      logoKey: content.logo_key,
      media: content.media,
      submittedAt: row.submitted_at,
      score: row.score,
      flags: row.flags,
      live:
        row.kind === 'revision'
          ? { tagline: booth.tagline, url: booth.url, logoKey: booth.logo_key }
          : null,
      maker: {
        id: maker.id,
        handle: maker.handle,
        displayName: maker.display_name,
        createdAt: maker.created_at,
        otherBooths: boothRows
          .filter((b) => b.owner_id === maker.id && b.id !== booth.id)
          .map((b) => ({ id: b.id, name: b.name, slug: b.slug, status: b.status })),
      },
    });
    if (item.success) items.push(item.data);
    else console.error(`admin queue: dropped ${row.kind} ${row.id}`, item.error.issues[0]);
  }
  return items;
}

export async function reviewQueue(env: Env, cursor: string | undefined): Promise<QueuePage> {
  const after = decodeCursor(cursor, Cursor);
  const db = serviceDb(env);
  const rows = z.array(QueueRow).parse(
    await db.select('admin_review_queue', {
      order: orderParam(SORT),
      limit: PAGE_FETCH,
      ...(after ? { or: afterFilter(SORT, after) } : {}),
    }),
  );
  const page = pageOf(rows, (r) => [r.score, r.submitted_at, r.id]);
  return { items: await cardsFor(db, page.rows), nextCursor: page.nextCursor };
}
