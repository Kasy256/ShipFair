import type { BoothOwn } from '@shipfair/shared';
import { describe, expect, it } from 'vitest';
import { boothNotices } from './booth-notices.ts';

const NOW = Date.parse('2026-10-30T12:00:00Z');

function booth(overrides: Partial<BoothOwn> = {}): BoothOwn {
  return {
    id: '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a10',
    ownerId: '00000000-0000-4000-8000-000000000001',
    slug: 'notice-me',
    name: 'Notice Me',
    tagline: 'A booth that wants to hear back',
    description: null,
    url: 'https://example.com/',
    districtId: 1,
    logoKey: null,
    media: [],
    pricing: null,
    tier: 'stall',
    status: 'pending',
    rejectReason: null,
    approvedAt: null,
    updatedAt: '2026-10-30T11:00:00Z',
    revision: null,
    ...overrides,
  };
}

const revision = (
  status: 'pending' | 'approved' | 'rejected',
  rejectReason: string | null = null,
) => ({
  id: '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a99',
  status,
  rejectReason,
  tagline: 'A booth that wants to hear back',
  description: null,
  url: 'https://example.com/',
  logoKey: 'u/x/logo.webp',
  media: [],
});

describe('boothNotices', () => {
  it('says nothing while a booth waits, then announces the decision once', () => {
    const first = boothNotices([booth()], {}, NOW);
    expect(first.notices).toEqual([]);

    const live = booth({ status: 'approved' });
    const second = boothNotices([live], first.seen, NOW);
    expect(second.notices).toEqual(['“Notice Me” is live in the city!']);
    expect(boothNotices([live], second.seen, NOW).notices).toEqual([]);
  });

  it('includes the rejection reason', () => {
    const seen = boothNotices([booth()], {}, NOW).seen;
    const rejected = booth({ status: 'rejected', rejectReason: 'Broken link' });
    expect(boothNotices([rejected], seen, NOW).notices).toEqual([
      '“Notice Me” needs changes: Broken link',
    ]);
  });

  it('announces edits to live booths', () => {
    const seen = boothNotices(
      [booth({ status: 'approved', revision: revision('pending') })],
      {},
      NOW,
    ).seen;
    expect(
      boothNotices(
        [booth({ status: 'approved', revision: revision('rejected', 'NSFW') })],
        seen,
        NOW,
      ).notices,
    ).toEqual(['Your edit to “Notice Me” needs changes: NSFW']);
    expect(
      boothNotices([booth({ status: 'approved', revision: revision('approved') })], seen, NOW)
        .notices,
    ).toEqual(['Your edit to “Notice Me” is live.']);
  });

  it('tells a new device only about recent decisions', () => {
    expect(boothNotices([booth({ status: 'approved' })], {}, NOW).notices).toHaveLength(1);
    const old = booth({ status: 'approved', updatedAt: '2026-09-01T00:00:00Z' });
    const result = boothNotices([old], {}, NOW);
    expect(result.notices).toEqual([]);
    expect(Object.keys(result.seen)).toEqual([old.id]);
  });

  it('forgets booths that are gone', () => {
    const seen = boothNotices([booth()], {}, NOW).seen;
    expect(boothNotices([], seen, NOW).seen).toEqual({});
  });
});
