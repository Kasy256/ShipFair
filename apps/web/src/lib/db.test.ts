import { describe, expect, it } from 'vitest';
import {
  BOOTH_PUBLIC_COLUMNS,
  BoothPublicFromRow,
  DistrictFromRow,
  GuestbookEntryFromRow,
  ProfilePublicFromRow,
} from './db.ts';

const owner = '00000000-0000-4000-8000-000000000001';

// Shaped like PostgREST responses from the local stack (timestamptz with microseconds and offset).
const boothRow = {
  id: '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a10',
  owner_id: owner,
  slug: 'example-pretend-pilot',
  name: 'Pretend Pilot',
  tagline: 'An imaginary agent that books imaginary flights',
  description: null,
  url: 'https://example.com/pretend-pilot',
  district_id: 1,
  logo_key: `u/${owner}/logo.webp`,
  media: [{ type: 'image', key: `u/${owner}/1.webp`, w: 1280, h: 720 }],
  pricing: 'freemium',
  tier: 'pavilion',
  approved_at: '2026-10-25T16:37:40.460123+00:00',
};

describe('BoothPublicFromRow', () => {
  it('maps a row to camelCase', () => {
    expect(BoothPublicFromRow.parse(boothRow)).toEqual({
      id: boothRow.id,
      ownerId: owner,
      slug: 'example-pretend-pilot',
      name: 'Pretend Pilot',
      tagline: 'An imaginary agent that books imaginary flights',
      description: null,
      url: 'https://example.com/pretend-pilot',
      districtId: 1,
      logoKey: `u/${owner}/logo.webp`,
      media: boothRow.media,
      pricing: 'freemium',
      tier: 'pavilion',
      approvedAt: '2026-10-25T16:37:40.460123+00:00',
    });
  });

  it('selects exactly the columns it maps', () => {
    expect([...BOOTH_PUBLIC_COLUMNS].sort()).toEqual(Object.keys(boothRow).sort());
  });

  it.each([
    ['a missing column', { ...boothRow, approved_at: undefined }],
    ['an unapproved booth', { ...boothRow, approved_at: null }],
    ['an unknown tier', { ...boothRow, tier: 'mega' }],
    ['a non-https url', { ...boothRow, url: 'http://example.com' }],
    ['a non-object', 'booth'],
    ['null', null],
  ])('rejects %s', (_, row) => {
    expect(BoothPublicFromRow.safeParse(row).success).toBe(false);
  });
});

describe('DistrictFromRow', () => {
  it('maps sort_order', () => {
    const row = { id: 3, slug: 'productivity', name: 'Productivity & SaaS', theme: 'productivity' };
    expect(DistrictFromRow.parse({ ...row, color: '#22c55e', sort_order: 3 })).toEqual({
      ...row,
      color: '#22c55e',
      sortOrder: 3,
    });
  });
});

describe('ProfilePublicFromRow', () => {
  it('maps a public_profiles row and fills avatar defaults', () => {
    const profile = ProfilePublicFromRow.parse({
      id: owner,
      handle: 'maker1',
      display_name: 'Maker One',
      avatar_style: {},
      links: { github: 'maker1' },
      created_at: '2026-10-25T16:37:40.460123+00:00',
    });
    expect(profile).toMatchObject({
      handle: 'maker1',
      displayName: 'Maker One',
      links: { github: 'maker1' },
    });
    expect(profile.avatarStyle.hair).toBe('short');
  });

  it('rejects a bad handle', () => {
    const row = { id: owner, handle: 'Maker One', display_name: 'x', avatar_style: {}, links: {} };
    expect(ProfilePublicFromRow.safeParse(row).success).toBe(false);
  });
});

describe('GuestbookEntryFromRow', () => {
  it('maps a row and drops the hidden flag', () => {
    expect(
      GuestbookEntryFromRow.parse({
        id: 7,
        booth_id: boothRow.id,
        author_id: owner,
        body: 'Nice booth!',
        hidden: false,
        created_at: '2026-10-25T16:37:40.460123+00:00',
      }),
    ).toEqual({
      id: 7,
      boothId: boothRow.id,
      authorId: owner,
      body: 'Nice booth!',
      createdAt: '2026-10-25T16:37:40.460123+00:00',
    });
  });
});
