import * as z from 'zod';
import { CHAT_MAX_CHARS, REPORT_CONTEXT_LINES, REPORT_NOTE_MAX_CHARS } from '../constants.ts';

export const ReportTargetType = z.enum(['booth', 'guestbook', 'chat', 'user']);
export type ReportTargetType = z.infer<typeof ReportTargetType>;
export const ReportReason = z.enum(['spam', 'scam', 'nsfw', 'hate', 'other']);
export type ReportReason = z.infer<typeof ReportReason>;
export const ReportStatus = z.enum(['open', 'actioned', 'dismissed']);
export type ReportStatus = z.infer<typeof ReportStatus>;

/** One chat line as the reporter received it (`ts` is the server's epoch ms). */
export const ChatLine = z.object({
  text: z.string().min(1).max(CHAT_MAX_CHARS),
  ts: z.int().nonnegative(),
});
export type ChatLine = z.infer<typeof ChatLine>;

/**
 * `reports.context` (prompt 12): the reported player's last chat lines that the reporter
 * received, oldest first. The database checks the same shape (`report_context_valid`).
 */
export const ReportContext = z.array(ChatLine).max(REPORT_CONTEXT_LINES);
export type ReportContext = z.infer<typeof ReportContext>;

export const ReportInput = z.object({
  targetType: ReportTargetType,
  /** Booth/user uuid, guestbook entry id, or a chat player reference. */
  targetId: z.string().min(1).max(64),
  reason: ReportReason,
  note: z.string().trim().max(REPORT_NOTE_MAX_CHARS).optional(),
  /** Chat lines, for `user` and `chat` reports only. */
  context: ReportContext.optional(),
});
export type ReportInput = z.infer<typeof ReportInput>;
