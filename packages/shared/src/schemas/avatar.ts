import * as z from 'zod';
import {
  ACCESSORY_IDS,
  BODY_IDS,
  BOTTOM_IDS,
  CAP_INCOMPATIBLE_HAIR,
  FACIAL_IDS,
  HAIR_COLOR_COUNT,
  HAIR_IDS,
  HARMONY_GROUPS,
  HEADWEAR_HIDES_HAIR,
  HEADWEAR_IDS,
  HEADWEAR_PARTIAL,
  PALETTE_COUNT,
  PALETTE_HEX,
  SHOES_IDS,
  SKIN_COUNT,
  SKIN_HEX,
  TOP_IDS,
} from '../generated/wardrobe-ids.ts';
import { pick, type Rng } from '../rng.ts';
import { HexColor, Slug } from './common.ts';

const PartId = z.string().regex(/^[a-z0-9_]{1,32}$/);

/**
 * Avatar style v1 (prompt 02): flat tints and free-text part ids. Still sent in `hello` until the
 * realtime prompts move the protocol to v2; stored styles are migrated with `migrateAvatarStyle`.
 */
export const AvatarStyle = z.object({
  skin: HexColor.default('#e0b18f'),
  top: HexColor.default('#3b82f6'),
  bottom: HexColor.default('#1f2937'),
  hair: PartId.default('short'),
  accessory: PartId.default('none'),
});
export type AvatarStyle = z.infer<typeof AvatarStyle>;
const AvatarStyleV1 = AvatarStyle;

/** Chest print patterns. Textures are added by the engine; ids are fixed here. */
export const PRINT_PATTERNS = ['stripes', 'dots', 'check', 'waves', 'stars'] as const;

const NONE = 'none';
const ItemOrNone = <T extends readonly [string, ...string[]]>(ids: T) => z.enum([NONE, ...ids]);
const SkinIndex = z
  .int()
  .min(0)
  .max(SKIN_COUNT - 1);
const HairColor = z
  .int()
  .min(0)
  .max(HAIR_COLOR_COUNT - 1);
const PaletteColor = z
  .int()
  .min(0)
  .max(PALETTE_COUNT - 1);

/** `none`, a pattern, the ShipFair logo, or `booth:<slug>` ("wear your booth", post-launch). */
export const PrintId = z.union([
  z.literal(NONE),
  z.enum(PRINT_PATTERNS),
  z.literal('shipfair'),
  z.templateLiteral(['booth:', Slug]),
]);
export type PrintId = z.infer<typeof PrintId>;

/**
 * Avatar style v2 (UPDATE-003). Stored in `profiles.avatar_style` jsonb and sent in `hello`.
 * Ids come from the generated art manifests, so unknown items are rejected. `skin` indexes
 * art/palette/skin.json, hair/brows/facial colours index hair.json, everything else palette.json.
 */
export const AvatarStyleV2 = z.object({
  v: z.literal(2),
  body: z.enum(BODY_IDS),
  skin: SkinIndex,
  hair: z.object({ item: z.enum(HAIR_IDS), color: HairColor }),
  brows: z.object({ color: HairColor }),
  facial: z.object({ item: ItemOrNone(FACIAL_IDS), color: HairColor }),
  headwear: z.object({ item: ItemOrNone(HEADWEAR_IDS), color: PaletteColor, color2: PaletteColor }),
  top: z.object({
    item: z.enum(TOP_IDS),
    color: PaletteColor,
    color2: PaletteColor,
    print: PrintId,
  }),
  bottom: z.object({
    item: z.enum(BOTTOM_IDS),
    color: PaletteColor,
    color2: PaletteColor.optional(),
  }),
  shoes: z.object({ item: z.enum(SHOES_IDS), color: PaletteColor, color2: PaletteColor }),
  accessory: z.object({ item: ItemOrNone(ACCESSORY_IDS), color: PaletteColor }),
});
export type AvatarStyleV2 = z.infer<typeof AvatarStyleV2>;

const HIDES_HAIR: ReadonlySet<string> = new Set(HEADWEAR_HIDES_HAIR);
const PARTIAL: ReadonlySet<string> = new Set(HEADWEAR_PARTIAL);
const CAP_INCOMPATIBLE: ReadonlySet<string> = new Set(CAP_INCOMPATIBLE_HAIR);

/** True when the hair is drawn (headwear like a hijab hides it but the choice is kept). */
export function isHairVisible(style: AvatarStyleV2): boolean {
  return !HIDES_HAIR.has(style.headwear.item);
}

/**
 * Cap, beanie or kufi over a large-volume style would clip, so the headwear goes to `none` (the
 * editor shows a hint). Everything else is returned unchanged.
 */
export function resolveHeadwear(style: AvatarStyleV2): AvatarStyleV2 {
  if (PARTIAL.has(style.headwear.item) && CAP_INCOMPATIBLE.has(style.hair.item)) {
    return { ...style, headwear: { ...style.headwear, item: NONE } };
  }
  return style;
}

export const DEFAULT_AVATAR_STYLE: AvatarStyleV2 = AvatarStyleV2.parse({
  v: 2,
  body: BODY_IDS.find((b) => b === 'superhero_m') ?? BODY_IDS[0],
  skin: 5,
  hair: { item: HAIR_IDS.find((h) => h === 'crew_cut') ?? HAIR_IDS[0], color: 1 },
  brows: { color: 1 },
  facial: { item: NONE, color: 1 },
  headwear: { item: NONE, color: 8, color2: 1 },
  top: { item: TOP_IDS[0], color: 8, color2: 1, print: NONE },
  bottom: { item: BOTTOM_IDS[0], color: 3, color2: 2 },
  shoes: { item: SHOES_IDS[0], color: 1, color2: 3 },
  accessory: { item: NONE, color: 9 },
});

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Index of the nearest colour (plain RGB distance is enough for these well-spaced palettes). */
export function nearestColor(hex: string, palette: readonly string[]): number {
  const [r, g, b] = rgb(hex);
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  palette.forEach((p, i) => {
    const [pr, pg, pb] = rgb(p);
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** v1 free-text hair ids that have an obvious v2 match. */
const V1_HAIR: Readonly<Record<string, string>> = {
  short: 'crew_cut',
  buzz: 'buzz',
  bald: 'bald',
  bun: 'bun_top',
  long: 'long_straight',
  afro: 'afro_round',
  curly: 'curly_mop',
  ponytail: 'ponytail_high',
  locs: 'locs_shoulder',
  braids: 'box_braids_long',
};

const asHair = (id: string | undefined) =>
  (HAIR_IDS as readonly string[]).includes(id ?? '')
    ? (id as AvatarStyleV2['hair']['item'])
    : undefined;

/**
 * Any stored style (v1 flat tints, v2, `{}` or garbage) -> a valid v2 style. v1 colours map to the
 * nearest palette entries; cap and beanie accessories move to the headwear slot.
 */
export function migrateAvatarStyle(input: unknown): AvatarStyleV2 {
  const v2 = AvatarStyleV2.safeParse(input);
  if (v2.success) return resolveHeadwear(v2.data);
  const v1 = AvatarStyleV1.safeParse(input ?? {});
  if (!v1.success) return DEFAULT_AVATAR_STYLE;
  const old = v1.data;
  const hairItem = asHair(V1_HAIR[old.hair] ?? old.hair) ?? DEFAULT_AVATAR_STYLE.hair.item;
  const headwear = (HEADWEAR_IDS as readonly string[]).includes(old.accessory)
    ? (old.accessory as AvatarStyleV2['headwear']['item'])
    : NONE;
  const accessory = (ACCESSORY_IDS as readonly string[]).includes(old.accessory)
    ? (old.accessory as AvatarStyleV2['accessory']['item'])
    : NONE;
  return resolveHeadwear({
    ...DEFAULT_AVATAR_STYLE,
    skin: nearestColor(old.skin, SKIN_HEX),
    hair: { ...DEFAULT_AVATAR_STYLE.hair, item: hairItem },
    headwear: { ...DEFAULT_AVATAR_STYLE.headwear, item: headwear },
    top: { ...DEFAULT_AVATAR_STYLE.top, color: nearestColor(old.top, PALETTE_HEX) },
    bottom: { ...DEFAULT_AVATAR_STYLE.bottom, color: nearestColor(old.bottom, PALETTE_HEX) },
    accessory: { ...DEFAULT_AVATAR_STYLE.accessory, item: accessory },
  });
}

/**
 * A coherent random look: one harmony group colours every garment, hair colours lean natural,
 * headwear, facial hair and accessories appear some of the time. Locked items are never picked
 * when `isLocked` says so. Mirrors tools/blender/lib/harmony.py (used by the previews).
 */
export function randomAvatarStyle(
  random: Rng,
  harmony: readonly (readonly number[])[] = HARMONY_GROUPS,
  isLocked: (id: string) => boolean = () => false,
): AvatarStyleV2 {
  const group = pick(random, harmony);
  const [main = 1, second = 3] = group;
  const third = group[2] ?? main;
  const open = <T extends string>(ids: readonly T[]) => ids.filter((id) => !isLocked(id));
  const hairColor = Math.floor(random() * Math.min(HAIR_COLOR_COUNT, 8));
  const maybe = <T extends string>(ids: readonly T[], chance: number): T | 'none' =>
    random() < chance && open(ids).length > 0 ? pick(random, open(ids)) : NONE;
  return resolveHeadwear({
    v: 2,
    body: pick(random, BODY_IDS),
    skin: Math.floor(random() * SKIN_COUNT),
    hair: { item: pick(random, open(HAIR_IDS)), color: hairColor },
    brows: { color: hairColor },
    facial: { item: maybe(FACIAL_IDS, 0.35), color: hairColor },
    headwear: { item: maybe(HEADWEAR_IDS, 0.3), color: second, color2: main },
    top: { item: pick(random, open(TOP_IDS)), color: main, color2: third, print: NONE },
    bottom: { item: pick(random, open(BOTTOM_IDS)), color: second, color2: main },
    shoes: { item: pick(random, open(SHOES_IDS)), color: third, color2: second },
    accessory: { item: maybe(ACCESSORY_IDS, 0.5), color: third },
  });
}
