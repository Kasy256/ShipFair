import { describe, expect, it } from 'vitest';
import {
  BanRequest,
  FeatureFlags,
  FLAG_DEFAULTS,
  FlagUpdate,
  HideRequest,
  RejectRequest,
  rejectReasonText,
} from './admin.ts';
import { UserSearchQuery } from './admin-views.ts';

const booth = '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a10';

describe('RejectRequest', () => {
  it('takes a reason from the list, with an optional note', () => {
    expect(RejectRequest.safeParse({ reason: 'broken_link' }).success).toBe(true);
    expect(RejectRequest.safeParse({ reason: 'nsfw', note: 'Second screenshot' }).success).toBe(
      true,
    );
    expect(RejectRequest.safeParse({ reason: 'ugly' }).success).toBe(false);
  });

  it('needs a note for "other"', () => {
    expect(RejectRequest.safeParse({ reason: 'other' }).success).toBe(false);
    expect(RejectRequest.safeParse({ reason: 'other', note: '   ' }).success).toBe(false);
    expect(RejectRequest.safeParse({ reason: 'other', note: 'Not a product' }).success).toBe(true);
  });
});

describe('rejectReasonText', () => {
  it('is the label, then the note', () => {
    expect(rejectReasonText('broken_link')).toBe('Broken link');
    expect(rejectReasonText('broken_link', ' 404 on load ')).toBe('Broken link: 404 on load');
    expect(rejectReasonText('other', 'Not a product you made')).toBe('Not a product you made');
  });
});

describe('HideRequest', () => {
  it('matches the id to the target type', () => {
    expect(
      HideRequest.safeParse({ targetType: 'booth', targetId: booth, hidden: true }).success,
    ).toBe(true);
    expect(
      HideRequest.safeParse({ targetType: 'booth', targetId: '12', hidden: true }).success,
    ).toBe(false);
    expect(
      HideRequest.safeParse({ targetType: 'guestbook', targetId: '12', hidden: false }).success,
    ).toBe(true);
    expect(
      HideRequest.safeParse({ targetType: 'guestbook', targetId: booth, hidden: true }).success,
    ).toBe(false);
  });
});

describe('BanRequest', () => {
  it('needs a reason; until is an ISO time', () => {
    expect(BanRequest.safeParse({ userId: booth, reason: 'spam' }).success).toBe(true);
    expect(BanRequest.safeParse({ userId: booth, reason: '' }).success).toBe(false);
    expect(
      BanRequest.safeParse({ userId: booth, reason: 'spam', until: '2026-11-01T00:00:00Z' })
        .success,
    ).toBe(true);
    expect(BanRequest.safeParse({ userId: booth, reason: 'spam', until: 'tomorrow' }).success).toBe(
      false,
    );
  });
});

describe('feature flags', () => {
  it('default to the TRUST_AND_SAFETY.md values', () => {
    expect(FLAG_DEFAULTS).toEqual({
      MIN_ACCOUNT_AGE_MINUTES: 60,
      GUEST_CHAT: false,
      NEW_ACCOUNT_CHAT_MINUTES: 0,
      SUBMISSIONS_OPEN: true,
    });
  });

  it('fall back per value, so one bad row breaks nothing else', () => {
    expect(
      FeatureFlags.parse({
        MIN_ACCOUNT_AGE_MINUTES: -5,
        SUBMISSIONS_OPEN: false,
        GUEST_CHAT: true,
      }),
    ).toEqual({ ...FLAG_DEFAULTS, SUBMISSIONS_OPEN: false });
  });

  it('accept edits of the right type only', () => {
    expect(FlagUpdate.safeParse({ key: 'SUBMISSIONS_OPEN', value: false }).success).toBe(true);
    expect(FlagUpdate.safeParse({ key: 'SUBMISSIONS_OPEN', value: 'no' }).success).toBe(false);
    expect(FlagUpdate.safeParse({ key: 'MIN_ACCOUNT_AGE_MINUTES', value: 1440 }).success).toBe(
      true,
    );
    expect(FlagUpdate.safeParse({ key: 'MIN_ACCOUNT_AGE_MINUTES', value: 1.5 }).success).toBe(
      false,
    );
    // Guests never chat in v1.
    expect(FlagUpdate.safeParse({ key: 'GUEST_CHAT', value: true }).success).toBe(false);
    expect(FlagUpdate.safeParse({ key: 'NOPE', value: 1 }).success).toBe(false);
  });
});

describe('UserSearchQuery', () => {
  it('lowercases handle prefixes and refuses anything else', () => {
    expect(UserSearchQuery.parse(' Maker_1 ')).toBe('maker_1');
    expect(UserSearchQuery.safeParse('a*').success).toBe(false);
    expect(UserSearchQuery.safeParse('a,b').success).toBe(false);
  });
});
