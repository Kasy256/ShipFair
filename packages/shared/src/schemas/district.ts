import * as z from 'zod';
import { HexColor, Slug } from './common.ts';

const SMALLINT_MAX = 32767;

export const DistrictId = z.int().min(1).max(SMALLINT_MAX);

export const District = z.object({
  id: DistrictId,
  slug: Slug,
  name: z.string().min(1).max(40),
  /** Engine theme key, e.g. `ai-agents`. */
  theme: z.string().regex(/^[a-z0-9-]{1,32}$/),
  color: HexColor,
  sortOrder: z.int().min(-SMALLINT_MAX).max(SMALLINT_MAX),
});
export type District = z.infer<typeof District>;
