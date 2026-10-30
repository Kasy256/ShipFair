import * as z from 'zod';
import { ADMIN_SEARCH_MAX_CHARS } from '../constants.ts';
import { BoothMedia, BoothPricing, BoothStatus } from './booth.ts';
import { HttpsUrl, MediaKey, Slug, Timestamp, Uuid } from './common.ts';
import { ReportReason, ReportStatus, ReportTargetType } from './report.ts';

// What `GET /api/admin/*` returns (prompt 09). The SPA parses every response with these.

/** A cursor-paginated list. `nextCursor` is opaque; null on the last page. */
export function adminPage<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/** `?cursor=` on list endpoints: base64url text, never parsed by the client. */
export const AdminCursor = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);

export const ProfileRole = z.enum(['user', 'moderator', 'admin']);
export type ProfileRole = z.infer<typeof ProfileRole>;

const UserRef = z.object({ id: Uuid, handle: z.string() });
export type UserRef = z.infer<typeof UserRef>;

const BoothRef = z.object({ id: Uuid, name: z.string(), slug: Slug, status: BoothStatus });
export type BoothRef = z.infer<typeof BoothRef>;

// Review queue -------------------------------------------------------------------------------------

export const QueueKind = z.enum(['booth', 'revision']);
export type QueueKind = z.infer<typeof QueueKind>;

export const QueueItem = z.object({
  kind: QueueKind,
  /** The booth id, or the revision id for an edit. Approve/reject take the booth id. */
  id: Uuid,
  boothId: Uuid,
  name: z.string(),
  slug: Slug,
  tagline: z.string(),
  description: z.string().nullable(),
  url: HttpsUrl,
  /** Where the URL ended up after redirects (pre-screen), null if it couldn't be reached. */
  finalUrl: HttpsUrl.nullable(),
  districtId: z.int(),
  pricing: BoothPricing.nullable(),
  logoKey: MediaKey.nullable(),
  media: z.array(BoothMedia),
  submittedAt: Timestamp,
  /** Pre-screen score: 0 is clean; 1000 means it was never pre-screened. */
  score: z.number(),
  flags: z.array(z.string()),
  /** For an edit: what is live now, to compare with. */
  live: z.object({ tagline: z.string(), url: HttpsUrl, logoKey: MediaKey.nullable() }).nullable(),
  maker: UserRef.extend({
    displayName: z.string(),
    createdAt: Timestamp,
    otherBooths: z.array(BoothRef),
  }),
});
export type QueueItem = z.infer<typeof QueueItem>;

export const QueuePage = adminPage(QueueItem);
export type QueuePage = z.infer<typeof QueuePage>;

// Reports ------------------------------------------------------------------------------------------

export const AdminReport = z.object({
  id: z.int(),
  targetType: ReportTargetType,
  targetId: z.string(),
  reason: ReportReason,
  note: z.string().nullable(),
  status: ReportStatus,
  createdAt: Timestamp,
  reporter: UserRef.nullable(),
});
export type AdminReport = z.infer<typeof AdminReport>;

/** Open reports about one target, with enough context to decide without leaving the inbox. */
export const ReportGroup = z.object({
  targetType: ReportTargetType,
  targetId: z.string(),
  openReports: z.int(),
  reporters: z.int(),
  firstAt: Timestamp,
  reports: z.array(AdminReport),
  booth: BoothRef.extend({
    tagline: z.string(),
    url: HttpsUrl,
    logoKey: MediaKey.nullable(),
    owner: UserRef.nullable(),
  }).nullable(),
  guestbook: z
    .object({
      id: z.string(),
      body: z.string(),
      hidden: z.boolean(),
      boothId: Uuid,
      author: UserRef.nullable(),
    })
    .nullable(),
  user: UserRef.nullable(),
});
export type ReportGroup = z.infer<typeof ReportGroup>;

export const ReportPage = adminPage(ReportGroup);
export type ReportPage = z.infer<typeof ReportPage>;

// Users and the log --------------------------------------------------------------------------------

export const AdminUser = UserRef.extend({
  displayName: z.string(),
  role: ProfileRole,
  createdAt: Timestamp,
});
export type AdminUser = z.infer<typeof AdminUser>;

export const UserPage = adminPage(AdminUser);
export type UserPage = z.infer<typeof UserPage>;

/** `?q=` on the user search: the start of a handle. */
export const UserSearchQuery = z
  .string()
  .trim()
  .toLowerCase()
  .max(ADMIN_SEARCH_MAX_CHARS)
  .regex(/^[a-z0-9_]*$/, 'Handles use a–z, 0–9 and _');

export const LogEntry = z.object({
  id: z.int(),
  actorId: Uuid.nullable(),
  actorHandle: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  detail: z.record(z.string(), z.unknown()),
  createdAt: Timestamp,
});
export type LogEntry = z.infer<typeof LogEntry>;

export const LogPage = adminPage(LogEntry);
export type LogPage = z.infer<typeof LogPage>;

/** Filters on `GET /api/admin/log`. */
export const LogFilter = z.object({
  action: z
    .string()
    .regex(/^[a-z_]{1,32}$/)
    .optional(),
  targetType: z
    .string()
    .regex(/^[a-z_]{1,32}$/)
    .optional(),
  targetId: z.string().min(1).max(64).optional(),
  actorId: Uuid.optional(),
});
export type LogFilter = z.infer<typeof LogFilter>;

export const AdminUserDetail = z.object({
  user: AdminUser,
  booths: z.array(BoothRef.extend({ approvedAt: Timestamp.nullable() })),
  reportsBy: z.array(AdminReport),
  reportsAgainst: z.array(AdminReport),
  ban: z
    .object({ reason: z.string(), until: Timestamp.nullable(), createdAt: Timestamp })
    .nullable(),
  log: z.array(LogEntry),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;
