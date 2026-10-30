import {
  AvatarStyleV2,
  DEFAULT_AVATAR_STYLE,
  GuestIdentity,
  guestName,
  type OwnProfile,
  UNLOCKS,
} from '@shipfair/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGuest, resetGuestCache, saveGuestStyle } from '../lib/guest-identity.ts';
import { safeReturnPath } from '../lib/supabase.ts';
import { parseDraft } from '../ui/profile/profile-draft.ts';
import {
  selectName,
  selectNeedsOnboarding,
  selectStyle,
  useSessionStore,
} from './session-store.ts';

const profile: OwnProfile = {
  id: '00000000-0000-4000-8000-000000000001',
  handle: 'ada',
  displayName: 'Ada',
  avatarStyle: { ...DEFAULT_AVATAR_STYLE, skin: 2 },
  links: {},
  onboardedAt: '2026-10-30T09:00:00+00:00',
};

/** A Map-backed localStorage, or one that throws (private mode) when `isBroken`. */
function fakeStorage(isBroken = false): Storage {
  const data = new Map<string, string>();
  const fail = () => {
    throw new Error('SecurityError');
  };
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (isBroken ? fail() : (data.get(k) ?? null)),
    setItem: (k, v) => (isBroken ? fail() : void data.set(k, v)),
    removeItem: (k) => void data.delete(k),
  };
}

describe('guest identity', () => {
  beforeEach(() => resetGuestCache());
  afterEach(() => vi.unstubAllGlobals());

  it('creates a random guest with a valid unlocked look and keeps it', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const guest = loadGuest();
    expect(GuestIdentity.safeParse(guest).success).toBe(true);
    expect(guest.avatarStyle.accessory.item in UNLOCKS).toBe(false);
    resetGuestCache();
    expect(loadGuest()).toEqual(guest); // read back from storage
  });

  it('falls back to memory when storage throws', () => {
    vi.stubGlobal('localStorage', fakeStorage(true));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const guest = loadGuest();
    expect(loadGuest().id).toBe(guest.id);
    const styled = saveGuestStyle({ ...DEFAULT_AVATAR_STYLE, skin: 7 });
    expect(styled.id).toBe(guest.id);
    expect(loadGuest().avatarStyle.skin).toBe(7);
  });

  it('replaces a damaged stored guest', () => {
    const storage = fakeStorage();
    storage.setItem('shipfair:guest', '{"v":1,"id":"nope"}');
    vi.stubGlobal('localStorage', storage);
    expect(loadGuest().id).not.toBe('nope');
  });
});

describe('session selectors', () => {
  afterEach(() => useSessionStore.getState().setGuest());

  it('name a guest Guest-#### from the id, like the server', () => {
    const s = useSessionStore.getState();
    s.setGuest();
    expect(selectName(useSessionStore.getState())).toBe(guestName(s.guest.id));
  });

  it('use the handle and the profile look when signed in, and the draft while editing', () => {
    useSessionStore.getState().setSignedIn(profile.id, profile);
    expect(selectName(useSessionStore.getState())).toBe('ada');
    expect(selectStyle(useSessionStore.getState()).skin).toBe(2);
    useSessionStore.getState().setDraftStyle({ ...DEFAULT_AVATAR_STYLE, skin: 9 });
    expect(selectStyle(useSessionStore.getState()).skin).toBe(9);
    useSessionStore.getState().setGuest();
    expect(useSessionStore.getState().draftStyle).toBeNull();
  });

  it('need onboarding until onboarded_at is set', () => {
    useSessionStore.getState().setSignedIn(profile.id, { ...profile, onboardedAt: null });
    expect(selectNeedsOnboarding(useSessionStore.getState())).toBe(true);
    useSessionStore.getState().setProfile(profile);
    expect(selectNeedsOnboarding(useSessionStore.getState())).toBe(false);
  });

  it('keep every style valid', () => {
    expect(AvatarStyleV2.safeParse(selectStyle(useSessionStore.getState())).success).toBe(true);
  });
});

describe('safeReturnPath', () => {
  it('keeps same-site paths and refuses everything else', () => {
    expect(safeReturnPath('/b/my-booth')).toBe('/b/my-booth');
    expect(safeReturnPath('/me')).toBe('/me');
    expect(safeReturnPath('//evil.example')).toBe('/');
    expect(safeReturnPath('https://evil.example')).toBe('/');
    expect(safeReturnPath('/\\evil.example')).toBe('/');
    expect(safeReturnPath('/auth/callback?code=x')).toBe('/');
    expect(safeReturnPath(null)).toBe('/');
  });
});

describe('parseDraft', () => {
  const draft = {
    handle: ' Ada_L ',
    displayName: '  Ada  Lovelace ',
    links: { reddit: 'u/ada_l', x: '@ada', github: 'https://github.com/ada-l', site: 'ada.dev' },
  };

  it('normalises handle, name and links', () => {
    const result = parseDraft(draft);
    expect(result).toEqual({
      ok: true,
      update: {
        handle: 'ada_l',
        displayName: 'Ada Lovelace',
        links: { reddit: 'ada_l', x: 'ada', github: 'ada-l', site: 'https://ada.dev' },
      },
    });
  });

  it('reports errors per field', () => {
    const result = parseDraft({
      ...draft,
      handle: 'a',
      displayName: 'Shit Head',
      links: { ...draft.links, site: 'http://ada.dev' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(['displayName', 'handle', 'site']);
  });
});
