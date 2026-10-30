import * as z from 'zod';
import { BOOTH_MEDIA_MAX } from '../constants.ts';
import { HttpsUrl, MediaKey, Slug, Timestamp, Uuid } from './common.ts';
import { DistrictId } from './district.ts';

const MEDIA_MAX_PX = 8192;

export const BoothTier = z.enum(['stall', 'booth', 'pavilion']);
export type BoothTier = z.infer<typeof BoothTier>;

export const BoothPricing = z.enum(['free', 'freemium', 'paid', 'open-source']);
export type BoothPricing = z.infer<typeof BoothPricing>;

export const BoothMedia = z.object({
  type: z.enum(['image', 'video']),
  key: MediaKey,
  w: z.int().min(1).max(MEDIA_MAX_PX),
  h: z.int().min(1).max(MEDIA_MAX_PX),
});
export type BoothMedia = z.infer<typeof BoothMedia>;

const BoothName = z.string().trim().min(2).max(40);
const BoothTagline = z.string().trim().min(10).max(90);
const BoothDescription = z.string().trim().max(600);
const BoothMediaList = z.array(BoothMedia).max(BOOTH_MEDIA_MAX);

/** An approved booth as every client sees it (`/api/world`, Supabase reads under RLS). */
export const BoothPublic = z.object({
  id: Uuid,
  ownerId: Uuid,
  slug: Slug,
  name: BoothName,
  tagline: BoothTagline,
  description: BoothDescription.nullable(),
  url: HttpsUrl,
  districtId: DistrictId,
  logoKey: MediaKey.nullable(),
  media: BoothMediaList,
  pricing: BoothPricing.nullable(),
  tier: BoothTier,
  approvedAt: Timestamp,
});
export type BoothPublic = z.infer<typeof BoothPublic>;

/** The `/submit` form. The slug is pre-filled with `slugify(name)` and stays editable until approval. */
export const BoothDraftInput = z.object({
  slug: Slug,
  name: BoothName,
  tagline: BoothTagline,
  description: BoothDescription.optional(),
  url: HttpsUrl,
  districtId: DistrictId,
  logoKey: MediaKey.optional(),
  media: BoothMediaList.default([]),
  pricing: BoothPricing.optional(),
});
export type BoothDraftInput = z.infer<typeof BoothDraftInput>;

export const BoothStatus = z.enum([
  'draft',
  'pending',
  'approved',
  'rejected',
  'hidden',
  'archived',
]);
export type BoothStatus = z.infer<typeof BoothStatus>;

export const RevisionStatus = z.enum(['pending', 'approved', 'rejected']);
export type RevisionStatus = z.infer<typeof RevisionStatus>;

/** The open (or last) edit of a live booth, as its owner sees it. */
export const BoothRevisionOwn = z.object({
  id: Uuid,
  status: RevisionStatus,
  rejectReason: z.string().nullable(),
  tagline: BoothTagline,
  description: BoothDescription.nullable(),
  url: HttpsUrl,
  logoKey: MediaKey,
  media: BoothMediaList,
});
export type BoothRevisionOwn = z.infer<typeof BoothRevisionOwn>;

/** A booth in "My booths" (any status; RLS lets owners read their own). */
export const BoothOwn = BoothPublic.omit({ approvedAt: true }).extend({
  status: BoothStatus,
  rejectReason: z.string().nullable(),
  approvedAt: Timestamp.nullable(),
  updatedAt: Timestamp,
  revision: BoothRevisionOwn.nullable().default(null),
});
export type BoothOwn = z.infer<typeof BoothOwn>;
