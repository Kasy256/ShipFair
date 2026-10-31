import * as z from 'zod';
import {
  BAN_REASON_MAX_CHARS,
  FLAG_MINUTES_MAX,
  MIN_ACCOUNT_AGE_MINUTES,
  REJECT_NOTE_MAX_CHARS,
} from '../constants.ts';
import { Timestamp, Uuid } from './common.ts';
import { ReportStatus } from './report.ts';

// Staff tools (prompt 09): request bodies for `/api/admin/*` and the feature flags. Responses
// (queue cards, report groups, user lookups, the log) are in admin-views.ts.

export const StaffRole = z.enum(['moderator', 'admin']);
export type StaffRole = z.infer<typeof StaffRole>;

/** GET /api/admin/me: who is signed in, for the `/admin` guard (403 for everyone else). */
export const AdminMe = z.object({ userId: Uuid, handle: z.string(), role: StaffRole });
export type AdminMe = z.infer<typeof AdminMe>;

// Rejections ---------------------------------------------------------------------------------------

/** TRUST_AND_SAFETY.md "Rejection": always a reason from this list, plus a note for "other". */
export const RejectReason = z.enum([
  'broken_link',
  'nsfw',
  'scam',
  'duplicate',
  'low_effort',
  'other',
]);
export type RejectReason = z.infer<typeof RejectReason>;

/** What the maker reads on `/me` ("Changes needed: Broken link"). */
export const REJECT_REASON_LABELS: Readonly<Record<RejectReason, string>> = {
  broken_link: 'Broken link',
  nsfw: 'Not safe for work',
  scam: 'Looks like a scam',
  duplicate: 'Duplicate of another booth',
  low_effort: 'Not enough detail yet',
  other: 'Other',
};

const Note = z.string().trim().max(REJECT_NOTE_MAX_CHARS);

/** POST /api/admin/booths/:id/reject */
export const RejectRequest = z
  .object({ reason: RejectReason, note: Note.optional() })
  .refine((r) => r.reason !== 'other' || (r.note ?? '').length > 0, {
    message: 'Add a note when the reason is "Other"',
    path: ['note'],
  });
export type RejectRequest = z.infer<typeof RejectRequest>;

/** The `reject_reason` stored on the booth: the label, then the note if there is one. */
export function rejectReasonText(reason: RejectReason, note?: string): string {
  const trimmed = note?.trim();
  if (reason === 'other' && trimmed) return trimmed;
  return trimmed ? `${REJECT_REASON_LABELS[reason]}: ${trimmed}` : REJECT_REASON_LABELS[reason];
}

// Hide, ban, reports -------------------------------------------------------------------------------

export const HideTargetType = z.enum(['booth', 'guestbook']);
export type HideTargetType = z.infer<typeof HideTargetType>;

/** POST /api/admin/hide. Booths are uuids, guestbook entries numeric ids. */
export const HideRequest = z
  .object({ targetType: HideTargetType, targetId: z.string().min(1).max(64), hidden: z.boolean() })
  .refine(
    (r) =>
      r.targetType === 'booth'
        ? Uuid.safeParse(r.targetId).success
        : /^[1-9][0-9]{0,18}$/.test(r.targetId),
    { message: 'Not an id of that kind', path: ['targetId'] },
  );
export type HideRequest = z.infer<typeof HideRequest>;

/** POST /api/admin/ban. No `until` means permanent. */
export const BanRequest = z.object({
  userId: Uuid,
  reason: z.string().trim().min(3).max(BAN_REASON_MAX_CHARS),
  until: Timestamp.optional(),
});
export type BanRequest = z.infer<typeof BanRequest>;

/** POST /api/admin/unban */
export const UnbanRequest = z.object({ userId: Uuid });
export type UnbanRequest = z.infer<typeof UnbanRequest>;

/** POST /api/admin/reports/:id */
export const ReportStatusRequest = z.object({ status: ReportStatus });
export type ReportStatusRequest = z.infer<typeof ReportStatusRequest>;

/** Every admin mutation answers this. `worldVersion` is set when the city changed. */
export const AdminActionResponse = z.object({
  ok: z.literal(true),
  worldVersion: z.int().nonnegative().optional(),
});
export type AdminActionResponse = z.infer<typeof AdminActionResponse>;

// Feature flags ------------------------------------------------------------------------------------

export const FlagKey = z.enum([
  'MIN_ACCOUNT_AGE_MINUTES',
  'GUEST_CHAT',
  'NEW_ACCOUNT_CHAT_MINUTES',
  'SUBMISSIONS_OPEN',
]);
export type FlagKey = z.infer<typeof FlagKey>;

const Minutes = z.int().min(0).max(FLAG_MINUTES_MAX);
/** Guests never chat in v1 (TRUST_AND_SAFETY.md "Chat"); the flag exists so it is wired. */
const GuestChat = z.literal(false);

/** One edit from /admin (PUT /api/admin/flags). */
export const FlagUpdate = z.discriminatedUnion('key', [
  z.object({ key: z.literal('MIN_ACCOUNT_AGE_MINUTES'), value: Minutes }),
  z.object({ key: z.literal('GUEST_CHAT'), value: GuestChat }),
  z.object({ key: z.literal('NEW_ACCOUNT_CHAT_MINUTES'), value: Minutes }),
  z.object({ key: z.literal('SUBMISSIONS_OPEN'), value: z.boolean() }),
]);
export type FlagUpdate = z.infer<typeof FlagUpdate>;

/**
 * The flags in force. Each value falls back to its default on its own, so a bad row (or a
 * missing one) never turns into a crash or a different flag's value.
 */
export const FeatureFlags = z.object({
  MIN_ACCOUNT_AGE_MINUTES: Minutes.catch(MIN_ACCOUNT_AGE_MINUTES),
  GUEST_CHAT: GuestChat.catch(false),
  NEW_ACCOUNT_CHAT_MINUTES: Minutes.catch(0),
  SUBMISSIONS_OPEN: z.boolean().catch(true),
});
export type FeatureFlags = z.infer<typeof FeatureFlags>;

export const FLAG_DEFAULTS: FeatureFlags = FeatureFlags.parse({});

/** GET /api/admin/flags: values plus who changed each one last. */
export const AdminFlags = z.object({
  flags: FeatureFlags,
  updated: z.array(
    z.object({ key: FlagKey, updatedAt: Timestamp, updatedBy: z.string().nullable() }),
  ),
});
export type AdminFlags = z.infer<typeof AdminFlags>;

/** GET /api/submissions/status: what the public submit form needs to know. */
export const SubmissionsStatus = z.object({ isOpen: z.boolean() });
export type SubmissionsStatus = z.infer<typeof SubmissionsStatus>;
