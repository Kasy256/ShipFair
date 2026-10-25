import * as z from 'zod';
import { BoothPublic } from './booth.ts';
import { Timestamp } from './common.ts';
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
