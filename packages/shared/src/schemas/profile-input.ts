import * as z from 'zod';
import { DISPLAY_NAME_MAX_CHARS } from '../constants.ts';
import { normaliseText } from '../normalise.ts';
import { filterProfanity } from '../text.ts';
import { Handle } from './common.ts';
import { ProfileLinks } from './profile.ts';

const isClean = (text: string) => !filterProfanity(text).hasProfanity;
const CLEAN_MESSAGE = 'Name tags are public, so pick something without rude words';

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
