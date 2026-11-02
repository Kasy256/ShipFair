import * as z from 'zod';
import {
  PASSPORT_BOOTH_MILESTONES,
  PASSPORT_EVIDENCE_ROWS_MAX,
  PASSPORT_MERGE_MAX,
  PASSPORT_STAMP_BATCH_MAX,
} from '../constants.ts';
import { UNLOCKS } from '../generated/wardrobe-ids.ts';
import { type AvatarStyleV2, DEFAULT_AVATAR_STYLE } from './avatar.ts';
import { Slug, Timestamp, Uuid } from './common.ts';

// Passport stamps (prompt 13). The browser never awards a stamp: the server derives every stamp
// from evidence (what a shard saw, or rows like votes) and the browser only asks it to check
// (ARCHITECTURE.md §7 "Passport trust model"). The same key format is a check in SQL.

/**
 * `district:<slug>`, `booths:<1|10|50|100>`, `first:<upvote|note|chat>`, `met-a-maker`, `squad`.
 * Mirrors the `passport_stamps_key_valid` check in SQL.
 */
export const StampKey = z
  .string()
  .max(64)
  .regex(
    /^(district:[a-z0-9-]{3,40}|booths:(1|10|50|100)|first:(upvote|note|chat)|met-a-maker|squad)$/,
    'Unknown stamp',
  );
export type StampKey = z.infer<typeof StampKey>;

/** Facts only a shard can see. Their keys are the stamps they earn. */
export const REALTIME_FACTS = ['met-a-maker', 'first:chat', 'squad'] as const;
export type RealtimeFact = (typeof REALTIME_FACTS)[number];

export type StampCategory = 'districts' | 'booths' | 'social';

export function stampCategory(stamp: string): StampCategory {
  if (stamp.startsWith('district:')) return 'districts';
  if (stamp.startsWith('booths:')) return 'booths';
  return 'social';
}

/** Milestone stamps a visitor of `count` booths holds. */
export function boothMilestones(count: number): StampKey[] {
  return PASSPORT_BOOTH_MILESTONES.filter((n) => count >= n).map((n) => `booths:${n}`);
}

/**
 * Whether a wardrobe `unlock` rule is met. `stamp:district:all` means a stamp for every district
 * in the world; `stamp:<key>` means that stamp. Unknown rules stay locked.
 */
export function isUnlockMet(
  rule: string,
  stamps: ReadonlySet<string>,
  districtSlugs: readonly string[],
): boolean {
  if (rule === 'stamp:district:all') {
    return districtSlugs.length > 0 && districtSlugs.every((s) => stamps.has(`district:${s}`));
  }
  return rule.startsWith('stamp:') && stamps.has(rule.slice('stamp:'.length));
}

/** Locked items among `itemIds` (catalog rules from `art/config/wardrobe.json`). */
export function lockedItems(
  itemIds: readonly string[],
  stamps: ReadonlySet<string>,
  districtSlugs: readonly string[],
): string[] {
  return itemIds.filter((id) => {
    const rule = UNLOCKS[id];
    return rule !== undefined && !isUnlockMet(rule, stamps, districtSlugs);
  });
}

/** The look's slots that hold a wardrobe item id. */
const ITEM_SLOTS = ['hair', 'facial', 'headwear', 'top', 'bottom', 'shoes', 'accessory'] as const;

/** The locked wardrobe items `style` wears. */
export function wornLockedItems(style: AvatarStyleV2): string[] {
  return ITEM_SLOTS.map((slot) => style[slot].item).filter((id) => UNLOCKS[id] !== undefined);
}

/**
 * `style` with each locked item not in `allowed` put back to that slot's default. The shard shows
 * other players a locked item only when the saved look (checked by SQL on save) wears it.
 */
export function withoutLockedItems(
  style: AvatarStyleV2,
  allowed: ReadonlySet<string>,
): AvatarStyleV2 {
  let out = style;
  for (const slot of ITEM_SLOTS) {
    const item = style[slot].item;
    if (UNLOCKS[item] === undefined || allowed.has(item)) continue;
    out = { ...out, [slot]: { ...out[slot], item: DEFAULT_AVATAR_STYLE[slot].item } };
  }
  return out;
}

/** `POST /api/passport/stamp` (signed in): stamps the browser thinks it earned. */
export const StampRequest = z.object({
  stamps: z.array(StampKey).min(1).max(PASSPORT_STAMP_BATCH_MAX),
});
export type StampRequest = z.infer<typeof StampRequest>;

/** `POST /api/passport/merge`: a guest's stamps, offered once after signing in. */
export const MergeRequest = z.object({
  guestId: Uuid,
  stamps: z.array(StampKey).max(PASSPORT_MERGE_MAX),
});
export type MergeRequest = z.infer<typeof MergeRequest>;

/**
 * Answer to both: `awarded` are held now; `pending` aren't backed by evidence yet (a shard
 * reports once a minute) and are awarded when it arrives. Anything else was refused.
 */
export const PassportAnswer = z.object({
  awarded: z.array(StampKey),
  pending: z.array(StampKey),
});
export type PassportAnswer = z.infer<typeof PassportAnswer>;

/** A stamp row as clients read it (`passport_stamps`, public). */
export const Stamp = z.object({ stamp: StampKey, createdAt: Timestamp });
export type Stamp = z.infer<typeof Stamp>;

/** A profile id, or `guest:<guestId>` (the shard's player key). */
export const PlayerKey = z
  .string()
  .regex(
    /^(guest:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'Not a player key',
  );

/** One thing a shard saw a player do, sent with its stats batch. */
export const PassportEvidence = z.discriminatedUnion('kind', [
  z.object({ player: PlayerKey, kind: z.literal('district'), key: Slug }),
  z.object({ player: PlayerKey, kind: z.literal('booth'), key: Uuid }),
  z.object({ player: PlayerKey, kind: z.literal('fact'), key: z.enum(REALTIME_FACTS) }),
]);
export type PassportEvidence = z.infer<typeof PassportEvidence>;

export const PassportEvidenceList = z.array(PassportEvidence).max(PASSPORT_EVIDENCE_ROWS_MAX);
