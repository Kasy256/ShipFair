import {
  type AvatarStyleV2,
  GuestIdentity,
  hashString,
  randomAvatarStyle,
  rng,
  UNLOCKS,
} from '@shipfair/shared';

const GUEST_KEY = 'shipfair:guest';

/** Locked wardrobe items (passport unlocks) are never handed out at random. */
export const isLockedItem = (id: string): boolean => id in UNLOCKS;

/** Kept in memory when storage is unavailable (private mode, blocked site data). */
let memory: GuestIdentity | undefined;

function save(guest: GuestIdentity): void {
  memory = guest;
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(guest));
  } catch (error) {
    console.warn('Could not keep the guest identity; it lasts until the tab closes', error);
  }
}

function read(): GuestIdentity | undefined {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (raw === null) return undefined;
    const parsed = GuestIdentity.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined; // no storage, or a damaged value: start a new guest
  }
}

/**
 * This browser's guest: a random id and a coherent random look, kept in localStorage. The shown
 * name (`Guest-####`) is derived from the id with the server's `guestName`, never stored.
 */
export function loadGuest(): GuestIdentity {
  if (memory) return memory;
  const stored = read();
  if (stored) {
    memory = stored;
    return stored;
  }
  const id = crypto.randomUUID();
  const guest: GuestIdentity = {
    v: 1,
    id,
    avatarStyle: randomAvatarStyle(rng(hashString(id)), undefined, isLockedItem),
  };
  save(guest);
  return guest;
}

/** Guests can change their look (not their name). */
export function saveGuestStyle(style: AvatarStyleV2): GuestIdentity {
  const next: GuestIdentity = { ...loadGuest(), avatarStyle: style };
  save(next);
  return next;
}

/** Tests only: forget the cached guest. */
export function resetGuestCache(): void {
  memory = undefined;
}
