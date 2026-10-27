import { type AvatarStyleV2, HAIR_HEX, PALETTE_HEX, SKIN_HEX } from '@shipfair/shared';
import { Color } from 'three';

/** `_REGION` colour slots (art/contract.json → avatar.regions), plus engine-only FACIAL. */
export const REGION = {
  SKIN: 0,
  TOP: 1,
  TOP2: 2,
  BOTTOM: 3,
  BOTTOM2: 4,
  SHOES: 5,
  SHOES2: 6,
  HAIR: 7,
  BROWS: 8,
  EYES: 9,
  ACCENT: 10,
  ACCENT2: 11,
  ACCESSORY: 12,
  /**
   * Reserved slot 13: facial hair is exported as HAIR, and the merge moves it here so the style's
   * own `facial.color` applies.
   */
  FACIAL: 13,
} as const;
export const COLOR_SLOTS = 16;
/** Eyes have no style colour. */
export const EYE_HEX = '#1d1b22';

/** Legacy body files paint regions by material name (SKIN, TOP, …) instead of `_REGION`. */
export const MATERIAL_REGION: Readonly<Record<string, number>> = {
  SKIN: REGION.SKIN,
  TOP: REGION.TOP,
  BOTTOM: REGION.BOTTOM,
  SHOES: REGION.SHOES,
  EYES: REGION.EYES,
  HAIR: REGION.HAIR,
  ACCENT: REGION.ACCENT,
};

const scratch = new Color();
const at = (list: readonly string[], i: number) => list[i] ?? list[0] ?? '#ff00ff';

function put(out: Float32Array, slot: number, hex: string): void {
  // setStyle converts sRGB hex to the linear working space the shader expects.
  scratch.setStyle(hex);
  out[slot * 3] = scratch.r;
  out[slot * 3 + 1] = scratch.g;
  out[slot * 3 + 2] = scratch.b;
}

/** Writes the 16 linear RGB slot colours for `style` into `out` (length 48). No allocation. */
export function writeAvatarColors(style: AvatarStyleV2, out: Float32Array): void {
  put(out, REGION.SKIN, at(SKIN_HEX, style.skin));
  put(out, REGION.TOP, at(PALETTE_HEX, style.top.color));
  put(out, REGION.TOP2, at(PALETTE_HEX, style.top.color2));
  put(out, REGION.BOTTOM, at(PALETTE_HEX, style.bottom.color));
  put(out, REGION.BOTTOM2, at(PALETTE_HEX, style.bottom.color2 ?? style.bottom.color));
  put(out, REGION.SHOES, at(PALETTE_HEX, style.shoes.color));
  put(out, REGION.SHOES2, at(PALETTE_HEX, style.shoes.color2));
  put(out, REGION.HAIR, at(HAIR_HEX, style.hair.color));
  put(out, REGION.BROWS, at(HAIR_HEX, style.brows.color));
  put(out, REGION.EYES, EYE_HEX);
  put(out, REGION.ACCENT, at(PALETTE_HEX, style.headwear.color));
  put(out, REGION.ACCENT2, at(PALETTE_HEX, style.headwear.color2));
  put(out, REGION.ACCESSORY, at(PALETTE_HEX, style.accessory.color));
  put(out, REGION.FACIAL, at(HAIR_HEX, style.facial.color));
  for (let slot = REGION.FACIAL + 1; slot < COLOR_SLOTS; slot++) put(out, slot, '#ff00ff');
}

/** Body zones hidden under the worn items, and hair zones hidden under the headwear. */
export function hiddenMasks(
  items: readonly { hides: number; hidesHairMask: number; kind: string }[],
): { body: number; hair: number } {
  let body = 0;
  let hair = 0;
  for (const item of items) {
    if (item.kind === 'headwear') hair |= item.hidesHairMask;
    else body |= item.hides;
  }
  return { body, hair };
}
