import {
  type AvatarStyleV2,
  type GuestIdentity,
  guestName,
  type OwnProfile,
} from '@shipfair/shared';
import { create } from 'zustand';
import { loadGuest, saveGuestStyle } from '../lib/guest-identity.ts';

export type SessionStatus = 'loading' | 'guest' | 'signed-in';

interface SessionState {
  /** `loading` until Supabase has restored (or not) a session. */
  status: SessionStatus;
  userId: string | null;
  /** The signed-in user's row; null for guests (and while it loads). */
  profile: OwnProfile | null;
  /** Always present: a signed-out visitor is this guest. */
  guest: GuestIdentity;
  /** The avatar editor's unsaved look, shown live in the world while the editor is open. */
  draftStyle: AvatarStyleV2 | null;
  setSignedIn(userId: string, profile: OwnProfile): void;
  setGuest(): void;
  setProfile(profile: OwnProfile): void;
  setGuestStyle(style: AvatarStyleV2): void;
  setDraftStyle(style: AvatarStyleV2 | null): void;
}

/** Who is playing: a guest or a signed-in user (CODING_STANDARDS.md §5, one store per domain). */
export const useSessionStore = create<SessionState>()((set) => ({
  status: 'loading',
  userId: null,
  profile: null,
  guest: loadGuest(),
  draftStyle: null,
  setSignedIn: (userId, profile) => set({ status: 'signed-in', userId, profile }),
  setGuest: () => set({ status: 'guest', userId: null, profile: null, draftStyle: null }),
  setProfile: (profile) => set({ profile }),
  setGuestStyle: (style) => set({ guest: saveGuestStyle(style) }),
  setDraftStyle: (style) => set({ draftStyle: style }),
}));

/** The saved look: the profile's when signed in, else the guest's. */
export const selectSavedStyle = (s: SessionState): AvatarStyleV2 =>
  s.profile?.avatarStyle ?? s.guest.avatarStyle;

/** What the world shows: the editor's draft while it is open, else the saved look. */
export const selectStyle = (s: SessionState): AvatarStyleV2 => s.draftStyle ?? selectSavedStyle(s);

/** Name tag text: the handle when signed in, else `Guest-####` (as the realtime server derives it). */
export const selectName = (s: SessionState): string =>
  s.profile ? s.profile.handle : guestName(s.guest.id);

/** True while a signed-in user hasn't picked a handle yet. */
export const selectNeedsOnboarding = (s: SessionState): boolean =>
  s.status === 'signed-in' && s.profile !== null && s.profile.onboardedAt === null;

export interface Session {
  status: SessionStatus;
  isGuest: boolean;
  profile: OwnProfile | null;
  style: AvatarStyleV2;
  name: string;
}

/** The current visitor, for components. */
export function useSession(): Session {
  const status = useSessionStore((s) => s.status);
  const profile = useSessionStore((s) => s.profile);
  const style = useSessionStore(selectStyle);
  const name = useSessionStore(selectName);
  return { status, isGuest: status !== 'signed-in', profile, style, name };
}
