import { describe, expect, it } from 'vitest';
import { DeleteAccountRequest, DeleteAccountResponse } from './api.ts';
import { DEFAULT_AVATAR_STYLE } from './avatar.ts';
import {
  DisplayNameInput,
  HandleInput,
  OwnProfile,
  ProfilePublic,
  ProfileUpdate,
} from './profile.ts';

const id = '00000000-0000-4000-8000-000000000001';

describe('ProfilePublic avatar styles', () => {
  it('migrates a v1 style on load', () => {
    const profile = ProfilePublic.parse({
      id,
      handle: 'ada',
      displayName: 'Ada',
      avatarStyle: { skin: '#301b11', hair: 'afro', accessory: 'cap' },
    });
    expect(profile.avatarStyle).toMatchObject({ v: 2, skin: 11, hair: { item: 'afro_round' } });
  });

  it('keeps a valid v2 style and replaces garbage with the default', () => {
    const v2 = { ...DEFAULT_AVATAR_STYLE, skin: 3 };
    expect(
      ProfilePublic.parse({ id, handle: 'ada', displayName: 'A', avatarStyle: v2 }).avatarStyle,
    ).toEqual(v2);
    expect(
      ProfilePublic.parse({ id, handle: 'ada', displayName: 'A', avatarStyle: 'nope' }).avatarStyle,
    ).toEqual(DEFAULT_AVATAR_STYLE);
  });
});

describe('OwnProfile', () => {
  it('carries onboardedAt, null until onboarding is done', () => {
    const base = { id, handle: 'maker_abc123', displayName: 'Maker' };
    expect(OwnProfile.parse({ ...base, onboardedAt: null }).onboardedAt).toBeNull();
    expect(
      OwnProfile.parse({ ...base, onboardedAt: '2026-10-30T09:00:00.123456+00:00' }).onboardedAt,
    ).toBe('2026-10-30T09:00:00.123456+00:00');
    expect(OwnProfile.safeParse(base).success).toBe(false);
  });
});

describe('profile inputs', () => {
  it('checks handles for format and rude words', () => {
    expect(HandleInput.safeParse('ada_l').success).toBe(true);
    expect(HandleInput.safeParse('Ada').success).toBe(false);
    expect(HandleInput.safeParse('ab').success).toBe(false);
    expect(HandleInput.safeParse('a'.repeat(21)).success).toBe(false);
    const rude = HandleInput.safeParse('shit_lord');
    expect(rude.success).toBe(false);
    expect(rude.error?.issues[0]?.message).toMatch(/rude words/);
  });

  it('normalises display names before checking them', () => {
    expect(DisplayNameInput.parse('  Ada ​  Lovelace ')).toBe('Ada Lovelace');
    expect(DisplayNameInput.safeParse('   ').success).toBe(false);
    expect(DisplayNameInput.safeParse('x'.repeat(33)).success).toBe(false);
    expect(DisplayNameInput.safeParse('Big Fucker').success).toBe(false);
    expect(DisplayNameInput.safeParse('Scunthorpe Fan').success).toBe(true);
  });

  it('validates a whole update, links included', () => {
    const ok = ProfileUpdate.safeParse({
      handle: 'ada',
      displayName: 'Ada',
      links: { github: 'ada-l', site: 'https://ada.dev' },
    });
    expect(ok.success).toBe(true);
    const badLink = ProfileUpdate.safeParse({
      handle: 'ada',
      displayName: 'Ada',
      links: { x: '@ada' },
    });
    expect(badLink.success).toBe(false);
  });
});

describe('account deletion API', () => {
  it('needs a handle and answers with the queued media count', () => {
    expect(DeleteAccountRequest.safeParse({ handle: 'ada' }).success).toBe(true);
    expect(DeleteAccountRequest.safeParse({}).success).toBe(false);
    expect(DeleteAccountResponse.parse({ ok: true, queuedMedia: 3 }).queuedMedia).toBe(3);
    expect(DeleteAccountResponse.safeParse({ ok: true, queuedMedia: -1 }).success).toBe(false);
  });
});
