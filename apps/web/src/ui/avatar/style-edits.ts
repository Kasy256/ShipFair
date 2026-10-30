import {
  AvatarStyleV2 as AvatarStyleSchema,
  type AvatarStyleV2,
  HARMONY_GROUPS,
  randomAvatarStyle,
  resolveHeadwear,
  rng,
} from '@shipfair/shared';
import { isLockedItem } from '../../lib/guest-identity.ts';

// Pure edits for the avatar editor. Each returns a new, schema-valid style; an edit that would
// produce an invalid style returns the input unchanged.

export type ItemSlot = 'facial' | 'headwear' | 'top' | 'bottom' | 'shoes' | 'accessory';
export type ColorField = 'color' | 'color2';

/** Brows and facial hair follow the hair colour until the user picks their own. */
export interface FollowHair {
  brows: boolean;
  facial: boolean;
}

const valid = (input: AvatarStyleV2, next: unknown): AvatarStyleV2 => {
  const parsed = AvatarStyleSchema.safeParse(next);
  return parsed.success ? parsed.data : input;
};

/** Initial follow state for a style: following when the colours already match. */
export function followsHair(style: AvatarStyleV2): FollowHair {
  return {
    brows: style.brows.color === style.hair.color,
    facial: style.facial.color === style.hair.color,
  };
}

export function setBody(style: AvatarStyleV2, body: string): AvatarStyleV2 {
  return valid(style, { ...style, body });
}

export function setSkin(style: AvatarStyleV2, skin: number): AvatarStyleV2 {
  return valid(style, { ...style, skin });
}

export function setHair(style: AvatarStyleV2, item: string): AvatarStyleV2 {
  return valid(style, { ...style, hair: { ...style.hair, item } });
}

export function setHairColor(style: AvatarStyleV2, color: number, follow: FollowHair) {
  return valid(style, {
    ...style,
    hair: { ...style.hair, color },
    brows: follow.brows ? { color } : style.brows,
    facial: follow.facial ? { ...style.facial, color } : style.facial,
  });
}

export function setBrowColor(style: AvatarStyleV2, color: number): AvatarStyleV2 {
  return valid(style, { ...style, brows: { color } });
}

export function setItem(style: AvatarStyleV2, slot: ItemSlot, item: string): AvatarStyleV2 {
  return valid(style, { ...style, [slot]: { ...style[slot], item } });
}

export function setColor(
  style: AvatarStyleV2,
  slot: ItemSlot,
  field: ColorField,
  color: number,
): AvatarStyleV2 {
  return valid(style, { ...style, [slot]: { ...style[slot], [field]: color } });
}

export function setPrint(style: AvatarStyleV2, print: string): AvatarStyleV2 {
  return valid(style, { ...style, top: { ...style.top, print } });
}

/**
 * Cap, beanie or kufi over a large-volume style would clip (`resolveHeadwear` drops it). The
 * editor disables those tiles instead of letting a choice silently vanish.
 */
export function headwearFits(style: AvatarStyleV2, headwear: string): boolean {
  if (headwear === 'none') return true;
  const tried = setItem(style, 'headwear', headwear);
  return resolveHeadwear(tried).headwear.item === headwear;
}

/** Hairstyles a partial headwear (cap, beanie, kufi) doesn't fit over, for the same reason. */
export function hairFits(style: AvatarStyleV2, hair: string): boolean {
  return headwearFits(setHair(style, hair), style.headwear.item);
}

/** "Randomise": a coherent look from the palette's harmony groups, never a locked item. */
export function randomise(seed: number): AvatarStyleV2 {
  return randomAvatarStyle(rng(seed), HARMONY_GROUPS, isLockedItem);
}
