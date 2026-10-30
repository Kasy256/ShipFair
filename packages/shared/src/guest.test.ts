import { describe, expect, it } from 'vitest';
import { GuestIdentity, guestName } from './guest.ts';
import { linkHref, normaliseLinkInput } from './profile-links.ts';
import { DEFAULT_AVATAR_STYLE } from './schemas/avatar.ts';

const id = '3f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a10';

describe('guestName', () => {
  it('is Guest- plus four digits, the same every time for an id', () => {
    expect(guestName(id)).toMatch(/^Guest-[1-9]\d{3}$/);
    expect(guestName(id)).toBe(guestName(id));
  });

  it('spreads ids over the range', () => {
    const names = new Set(
      Array.from({ length: 200 }, (_, i) =>
        guestName(`${id.slice(0, -3)}${String(i).padStart(3, '0')}`),
      ),
    );
    expect(names.size).toBeGreaterThan(190);
  });
});

describe('GuestIdentity', () => {
  it('parses a stored guest and migrates its style', () => {
    const guest = GuestIdentity.parse({ v: 1, id, avatarStyle: { skin: '#f6d9c6' } });
    expect(guest.avatarStyle.v).toBe(2);
    expect(guest.avatarStyle.skin).toBe(0);
  });

  it('rejects a bad id and falls back to the default style for garbage', () => {
    expect(GuestIdentity.safeParse({ v: 1, id: 'nope', avatarStyle: {} }).success).toBe(false);
    expect(GuestIdentity.parse({ v: 1, id, avatarStyle: 42 }).avatarStyle).toEqual(
      DEFAULT_AVATAR_STYLE,
    );
  });
});

describe('normaliseLinkInput', () => {
  it('strips profile URLs, @ and u/ down to the username', () => {
    expect(normaliseLinkInput('reddit', 'https://www.reddit.com/user/ada_l/')).toBe('ada_l');
    expect(normaliseLinkInput('reddit', 'u/ada_l')).toBe('ada_l');
    expect(normaliseLinkInput('x', '@ada')).toBe('ada');
    expect(normaliseLinkInput('x', 'https://twitter.com/ada?s=20')).toBe('ada');
    expect(normaliseLinkInput('github', 'github.com/ada-l')).toBe('ada-l');
    expect(normaliseLinkInput('github', ' ada-l ')).toBe('ada-l');
  });

  it('adds https to a bare website and keeps other schemes for validation to refuse', () => {
    expect(normaliseLinkInput('site', 'ada.dev')).toBe('https://ada.dev');
    expect(normaliseLinkInput('site', 'http://ada.dev')).toBe('http://ada.dev');
  });

  it('treats empty input as no link', () => {
    expect(normaliseLinkInput('github', '   ')).toBeUndefined();
  });
});

describe('linkHref', () => {
  it('builds profile URLs', () => {
    expect(linkHref('reddit', 'ada_l')).toBe('https://www.reddit.com/user/ada_l');
    expect(linkHref('x', 'ada')).toBe('https://x.com/ada');
    expect(linkHref('github', 'ada-l')).toBe('https://github.com/ada-l');
    expect(linkHref('site', 'https://ada.dev')).toBe('https://ada.dev');
  });
});
