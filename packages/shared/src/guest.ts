import * as z from 'zod';
import { hashString } from './rng.ts';
import { migrateAvatarStyle } from './schemas/avatar.ts';
import { Uuid } from './schemas/common.ts';

const GUEST_NUMBER_MIN = 1000;
const GUEST_NUMBER_SPAN = 9000;

/** murmur3's fmix32: FNV-1a alone barely changes its low bits when only the last characters differ. */
function mix(h: number): number {
  let x = h;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * `Guest-####` for a guest id. The realtime server derives the shown name with this function
 * (ARCHITECTURE.md §7), so clients can't pick a guest name; the web app calls it too, so the
 * guest sees the same name before connecting. Always four digits.
 */
export function guestName(guestId: string): string {
  return `Guest-${GUEST_NUMBER_MIN + (mix(hashString(guestId)) % GUEST_NUMBER_SPAN)}`;
}

/** A guest's identity as the browser keeps it in localStorage (parsed like any other input). */
export const GuestIdentity = z.object({
  v: z.literal(1),
  id: Uuid,
  avatarStyle: z.unknown().transform((value) => migrateAvatarStyle(value)),
});
export type GuestIdentity = z.infer<typeof GuestIdentity>;
