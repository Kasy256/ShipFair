import * as z from 'zod';
import { REPORT_NOTE_MAX_CHARS } from '../constants.ts';

export const ReportTargetType = z.enum(['booth', 'guestbook', 'chat', 'user']);
export type ReportTargetType = z.infer<typeof ReportTargetType>;
export const ReportReason = z.enum(['spam', 'scam', 'nsfw', 'hate', 'other']);
export type ReportReason = z.infer<typeof ReportReason>;
export const ReportStatus = z.enum(['open', 'actioned', 'dismissed']);
export type ReportStatus = z.infer<typeof ReportStatus>;

export const ReportInput = z.object({
  targetType: ReportTargetType,
  /** Booth/user uuid, guestbook entry id, or a chat player reference. */
  targetId: z.string().min(1).max(64),
  reason: ReportReason,
  note: z.string().trim().max(REPORT_NOTE_MAX_CHARS).optional(),
});
export type ReportInput = z.infer<typeof ReportInput>;
