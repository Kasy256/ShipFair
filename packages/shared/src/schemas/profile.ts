import * as z from 'zod';
import { filterProfanity, normaliseText } from '../text.ts';
import { migrateAvatarStyle } from './avatar.ts';
import { Handle, HttpsUrl, Timestamp, Uuid } from './common.ts';

const DISPLAY_NAME_MAX_CHARS = 32;
const isClean = (text: string) => !filterProfanity(text).hasProfanity;
const CLEAN_MESSAGE = 'Name tags are public, so pick something without rude words';

export const ProfileLinks = z.object({
  reddit: z
    .string()
    .regex(/^[A-Za-z0-9_-]{3,20}$/, 'Use your Reddit username (3–20 letters, digits, _ or -)')
    .optional(),
  x: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,15}$/, 'Use your X handle without the @ (up to 15 characters)')
    .optional(),
  github: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,39}$/, 'Use your GitHub username (letters, digits or -)')
    .optional(),
  site: HttpsUrl.optional(),
});
export type ProfileLinks = z.infer<typeof ProfileLinks>;

/**
 * Any stored `avatar_style` (v1 tints, v2, `{}` or garbage) parses to a valid v2 style, so an
 * old row never breaks a profile read (prompt 07: "old styles are migrated on load").
 */
const StoredAvatarStyle = z
  .unknown()
  .transform((value) => migrateAvatarStyle(value))
  .prefault({});

/** Public columns from the `public_profiles` view. `role` is not public. */
export const ProfilePublic = z.object({
  id: Uuid,
  handle: Handle,
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_CHARS),
  avatarStyle: StoredAvatarStyle,
  links: ProfileLinks.default({}),
});
export type ProfilePublic = z.infer<typeof ProfilePublic>;

/** The signed-in user's own row: the public fields plus whether onboarding is done. */
export const OwnProfile = ProfilePublic.extend({
  /** Null until the user picks a handle on first sign-in. */
  onboardedAt: Timestamp.nullable(),
});
export type OwnProfile = z.infer<typeof OwnProfile>;

/** A booth owner as the world snapshot shows them in booth panels: name and links, no avatar. */
export const MakerPublic = ProfilePublic.pick({
  id: true,
  handle: true,
  displayName: true,
  links: true,
});
export type MakerPublic = z.infer<typeof MakerPublic>;

/** A handle the user types: the format, and the chat filter (the database checks both again). */
export const HandleInput = Handle.refine(isClean, CLEAN_MESSAGE);

/** A display name the user types: normalised like all user text, 1–32 chars, filtered. */
export const DisplayNameInput = z
  .string()
  .transform(normaliseText)
  .pipe(
    z
      .string()
      .min(1, 'Add a display name')
      .max(DISPLAY_NAME_MAX_CHARS, `Keep it to ${DISPLAY_NAME_MAX_CHARS} characters`)
      .refine(isClean, CLEAN_MESSAGE),
  );

/** What onboarding and `/me` write to `profiles` (the avatar is saved on its own). */
export const ProfileUpdate = z.object({
  handle: HandleInput,
  displayName: DisplayNameInput,
  links: ProfileLinks,
});
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;
export type ProfileUpdateInput = z.input<typeof ProfileUpdate>;
