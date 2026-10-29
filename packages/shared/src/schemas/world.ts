import * as z from 'zod';
import { BoothPublic } from './booth.ts';
import { Timestamp, Uuid } from './common.ts';
import { District } from './district.ts';

/** Everything needed to build the city: the `/api/world` body and the input to `layoutCity`. */
export const WorldSnapshot = z.object({
  /** World cache version; bumped by `purgeWorld()` on approvals and tier changes. */
  version: z.int().nonnegative(),
  generatedAt: Timestamp,
  districts: z.array(District),
  booths: z.array(BoothPublic),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshot>;

/**
 * A booth approved, edited or taken down since the snapshot (`engine.updateBooths`). Upserting a
 * known id updates it in place; a new id takes the next free lot. Existing booths never move.
 */
export const BoothChange = z.discriminatedUnion('type', [
  z.object({ type: z.literal('upsert'), booth: BoothPublic }),
  z.object({ type: z.literal('remove'), boothId: Uuid }),
]);
export type BoothChange = z.infer<typeof BoothChange>;
