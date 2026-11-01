import * as z from 'zod';
import { GUESTBOOK_MAX_CHARS } from '../constants.ts';
import { Handle, Timestamp, Uuid } from './common.ts';

export const GuestbookEntry = z.object({
  id: z.int().positive(),
  boothId: Uuid,
  authorId: Uuid,
  body: z.string().min(1).max(GUESTBOOK_MAX_CHARS),
  createdAt: Timestamp,
});
export type GuestbookEntry = z.infer<typeof GuestbookEntry>;

/** An entry as the booth panel lists it (view `guestbook_public`): the author's names included. */
export const GuestbookEntryPublic = GuestbookEntry.extend({
  authorHandle: Handle,
  authorName: z.string().min(1).max(32),
});
export type GuestbookEntryPublic = z.infer<typeof GuestbookEntryPublic>;

/** The composer. The database filters the text again (trigger `guestbook_entries_filter`). */
export const GuestbookInput = z.object({
  boothId: Uuid,
  body: z.string().trim().min(1).max(GUESTBOOK_MAX_CHARS),
});
export type GuestbookInput = z.infer<typeof GuestbookInput>;
