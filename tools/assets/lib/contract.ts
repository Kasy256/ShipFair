// `art/contract.json` (written by prompt 04a) is the single source for names, slots, clips and
// budgets. This schema covers only the parts `pnpm assets:build` reads.
import * as z from 'zod';

const Budget = z.object({
  triangles: z.int().positive().optional(),
  materials: z.int().positive().optional(),
  fileKB: z.number().positive().optional(),
  deformBones: z.int().positive().optional(),
});
export type Budget = z.infer<typeof Budget>;

export const Contract = z.object({
  lot: z.object({ widthM: z.number(), depthM: z.number() }),
  materials: z.object({
    character: z.array(z.string()).min(1),
    palette: z.string(),
    accent: z.string(),
    glow: z.string(),
  }),
  clips: z.array(z.string()).min(1),
  boothKit: z.object({
    parts: z.record(z.string(), z.int().positive()),
    tiers: z.array(z.string()).min(1),
    tierSlots: z.record(z.string(), z.array(z.string())),
    tierLots: z.record(z.string(), z.int().positive()),
  }),
  budgets: z.object({
    characterLod0: Budget,
    characterLod1: Budget,
    animationSet: Budget,
    boothKit: Budget,
    prop: Budget,
  }),
  avatar: z.object({
    attributes: z.object({ region: z.string(), mask: z.string(), uvPrint: z.string() }),
    regions: z.record(z.string(), z.int().min(0).max(15)),
    budgets: z.object({
      garment: z.int(),
      hair: z.int(),
      hairLong: z.int(),
      facial: z.int(),
      headwear: z.int(),
      accessory: z.int(),
      avatarLod0: z.int(),
      avatarLod1: z.int(),
    }),
  }),
});
export type Contract = z.infer<typeof Contract>;
