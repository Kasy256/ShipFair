import {
  BoothOwn,
  BoothPublic,
  BoothRevisionOwn,
  type BoothTier,
  District,
  type Enums,
  GuestbookEntry,
  MakerPublic,
  OwnProfile,
  ProfilePublic,
  type Tables,
} from '@shipfair/shared';
import * as z from 'zod';

// The Supabase boundary: rows come in snake_case (typed by the generated db.types.ts), leave as the
// shared camelCase schemas. Every row is untrusted input, so each schema parses the result too.

// The output literal must name every field of the target schema, and nothing else.
type FieldsOf<T> = { [K in keyof Required<T>]: unknown };

const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Columns to select for `BoothPublicFromRow`, e.g. `.select(BOOTH_PUBLIC_COLUMNS.join(','))`. */
export const BOOTH_PUBLIC_COLUMNS = [
  'id',
  'owner_id',
  'slug',
  'name',
  'tagline',
  'description',
  'url',
  'district_id',
  'logo_key',
  'media',
  'pricing',
  'tier',
  'approved_at',
] as const satisfies readonly (keyof Tables<'booths'>)[];
type BoothPublicRow = Pick<Tables<'booths'>, (typeof BOOTH_PUBLIC_COLUMNS)[number]>;

export const BoothPublicFromRow = z
  .custom<BoothPublicRow>(isRow)
  .transform(
    (row): unknown =>
      ({
        id: row.id,
        ownerId: row.owner_id,
        slug: row.slug,
        name: row.name,
        tagline: row.tagline,
        description: row.description,
        url: row.url,
        districtId: row.district_id,
        logoKey: row.logo_key,
        media: row.media,
        pricing: row.pricing,
        tier: row.tier,
        approvedAt: row.approved_at,
      }) satisfies FieldsOf<BoothPublic>,
  )
  .pipe(BoothPublic);

/** Columns of a maker's own booth, any status (RLS: owners read their own). */
export const BOOTH_OWN_COLUMNS = [
  ...BOOTH_PUBLIC_COLUMNS,
  'status',
  'reject_reason',
  'updated_at',
] as const satisfies readonly (keyof Tables<'booths'>)[];
type BoothOwnRow = Pick<Tables<'booths'>, (typeof BOOTH_OWN_COLUMNS)[number]>;

export const REVISION_OWN_COLUMNS = [
  'id',
  'booth_id',
  'status',
  'reject_reason',
  'tagline',
  'description',
  'url',
  'logo_key',
  'media',
  'created_at',
] as const satisfies readonly (keyof Tables<'booth_revisions'>)[];
type RevisionOwnRow = Pick<Tables<'booth_revisions'>, (typeof REVISION_OWN_COLUMNS)[number]>;

export const RevisionOwnFromRow = z
  .custom<RevisionOwnRow>(isRow)
  .transform(
    (row): unknown =>
      ({
        id: row.id,
        status: row.status,
        rejectReason: row.reject_reason,
        tagline: row.tagline,
        description: row.description,
        url: row.url,
        logoKey: row.logo_key,
        media: row.media,
      }) satisfies FieldsOf<BoothRevisionOwn>,
  )
  .pipe(BoothRevisionOwn);

const BoothOwnFromRow = z
  .custom<BoothOwnRow>(isRow)
  .transform(
    (row): unknown =>
      ({
        id: row.id,
        ownerId: row.owner_id,
        slug: row.slug,
        name: row.name,
        tagline: row.tagline,
        description: row.description,
        url: row.url,
        districtId: row.district_id,
        logoKey: row.logo_key,
        media: row.media,
        pricing: row.pricing,
        tier: row.tier,
        status: row.status,
        rejectReason: row.reject_reason,
        approvedAt: row.approved_at,
        updatedAt: row.updated_at,
        revision: null,
      }) satisfies FieldsOf<BoothOwn>,
  )
  .pipe(BoothOwn);

/** A maker's booth row with its latest revision row (null when it has none). */
export function boothOwnFromRow(row: unknown, revision: unknown): BoothOwn {
  const booth = BoothOwnFromRow.parse(row);
  return { ...booth, revision: revision ? RevisionOwnFromRow.parse(revision) : null };
}

export const DistrictFromRow = z
  .custom<Tables<'districts'>>(isRow)
  .transform(
    (row): unknown =>
      ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        theme: row.theme,
        color: row.color,
        sortOrder: row.sort_order,
      }) satisfies FieldsOf<District>,
  )
  .pipe(District);

/** Rows of the `public_profiles` view (the table's `role` column isn't readable by clients). */
export const ProfilePublicFromRow = z
  .custom<Tables<'public_profiles'>>(isRow)
  .transform(
    (row): unknown =>
      ({
        id: row.id,
        handle: row.handle,
        displayName: row.display_name,
        avatarStyle: row.avatar_style,
        links: row.links,
      }) satisfies FieldsOf<ProfilePublic>,
  )
  .pipe(ProfilePublic);

/** Columns the signed-in user may read on their own `profiles` row (never `role`). */
export const OWN_PROFILE_COLUMNS = [
  'id',
  'handle',
  'display_name',
  'avatar_style',
  'links',
  'onboarded_at',
] as const satisfies readonly (keyof Tables<'profiles'>)[];
type OwnProfileRow = Pick<Tables<'profiles'>, (typeof OWN_PROFILE_COLUMNS)[number]>;

/** The signed-in user's row; the stored avatar style is migrated to v2 on the way in. */
export const OwnProfileFromRow = z
  .custom<OwnProfileRow>(isRow)
  .transform(
    (row): unknown =>
      ({
        id: row.id,
        handle: row.handle,
        displayName: row.display_name,
        avatarStyle: row.avatar_style,
        links: row.links,
        onboardedAt: row.onboarded_at,
      }) satisfies FieldsOf<OwnProfile>,
  )
  .pipe(OwnProfile);

/** Columns to select from `public_profiles` for `MakerFromRow`. */
export const MAKER_COLUMNS = [
  'id',
  'handle',
  'display_name',
  'links',
] as const satisfies readonly (keyof Tables<'public_profiles'>)[];
type MakerRow = Pick<Tables<'public_profiles'>, (typeof MAKER_COLUMNS)[number]>;

/** A booth owner for the world snapshot (no avatar, no join date). */
export const MakerFromRow = z
  .custom<MakerRow>(isRow)
  .transform(
    (row): unknown =>
      ({
        id: row.id,
        handle: row.handle,
        displayName: row.display_name,
        links: row.links,
      }) satisfies FieldsOf<MakerPublic>,
  )
  .pipe(MakerPublic);

export const GuestbookEntryFromRow = z
  .custom<Tables<'guestbook_entries'>>(isRow)
  .transform(
    (row): unknown =>
      ({
        id: row.id,
        boothId: row.booth_id,
        authorId: row.author_id,
        body: row.body,
        createdAt: row.created_at,
      }) satisfies FieldsOf<GuestbookEntry>,
  )
  .pipe(GuestbookEntry);

// Compile-time drift check: the DB enum and the shared zod enum must list the same tiers.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
true satisfies Same<Enums<'booth_tier'>, BoothTier>;
true satisfies Same<Enums<'booth_status'>, BoothOwn['status']>;
true satisfies Same<Enums<'revision_status'>, BoothRevisionOwn['status']>;
