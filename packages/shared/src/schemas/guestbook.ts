import * as z from 'zod';
import { GUESTBOOK_MAX_CHARS } from '../constants.ts';
import { Timestamp, Uuid } from './common.ts';

export const GuestbookEntry = z.object({
  id: z.int().positive(),
  boothId: Uuid,
  authorId: Uuid,
  body: z.string().min(1).max(GUESTBOOK_MAX_CHARS),
  createdAt: Timestamp,
});
export type GuestbookEntry = z.infer<typeof GuestbookEntry>;
