import * as z from 'zod';
import { Handle, HexColor, HttpsUrl, Uuid } from './common.ts';

const PartId = z.string().regex(/^[a-z0-9_]{1,32}$/);

/**
 * Stored as `profiles.avatar_style` jsonb, which defaults to `{}`, so every field has a default.
 * Prompt 04b adds `body` and palette tint indices; keep new fields defaulted for old JSON.
 */
export const AvatarStyle = z.object({
  skin: HexColor.default('#e0b18f'),
  top: HexColor.default('#3b82f6'),
  bottom: HexColor.default('#1f2937'),
  hair: PartId.default('short'),
  accessory: PartId.default('none'),
});
export type AvatarStyle = z.infer<typeof AvatarStyle>;

export const ProfileLinks = z.object({
  reddit: z
    .string()
    .regex(/^[A-Za-z0-9_-]{3,20}$/)
    .optional(),
  x: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,15}$/)
    .optional(),
  github: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,39}$/)
    .optional(),
  site: HttpsUrl.optional(),
});
export type ProfileLinks = z.infer<typeof ProfileLinks>;

/** Public columns from the `public_profiles` view. `role` is not public. */
export const ProfilePublic = z.object({
  id: Uuid,
  handle: Handle,
  displayName: z.string().trim().min(1).max(32),
  // prefault parses `{}` through AvatarStyle, so a missing value gets every field's default.
  avatarStyle: AvatarStyle.prefault({}),
  links: ProfileLinks.default({}),
});
export type ProfilePublic = z.infer<typeof ProfilePublic>;

/** A booth owner as the world snapshot shows them in booth panels: name and links, no avatar. */
export const MakerPublic = ProfilePublic.pick({
  id: true,
  handle: true,
  displayName: true,
  links: true,
});
export type MakerPublic = z.infer<typeof MakerPublic>;
