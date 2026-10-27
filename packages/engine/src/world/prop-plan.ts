import { type DistrictLayout, hashString, LOT_D_M, LOT_W_M, pick, rng } from '@shipfair/shared';

export interface PropPlacement {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** Street lamp on every other lot's front-left corner. */
export const STREET_LAMP = 'lamp_01';
/** Chance that a lot gets a themed decor prop on its front-right corner. */
const DECOR_CHANCE = 0.6;
/** Props stand this far into the street from the lot's front edge, and in from its sides. */
const CURB_M = 0.6;
const SIDE_INSET_M = 0.7;

/** Decor per district theme (prop ids from art/manifest.json). Unknown themes use `default`. */
export const PROP_SETS: Readonly<Record<string, readonly string[]>> = {
  default: ['bench_01', 'planter_01', 'bin_01', 'tree_01'],
  'ai-agents': ['bench_02', 'planter_01', 'plant_01', 'lamp_floor_01'],
  'dev-tools': ['table_01', 'chair_01', 'laptop_01', 'bin_01'],
  productivity: ['bench_01', 'sofa_01', 'plant_02', 'table_02'],
  design: ['lounge_01', 'parasol_01', 'plant_01', 'chair_03'],
  marketing: ['bench_02', 'parasol_01', 'planter_01', 'tree_02'],
  'finance-ops': ['bench_01', 'bin_01', 'planter_01', 'table_03'],
  'games-fun': ['cone_01', 'barrier_01', 'chair_02', 'tree_01'],
  weird: ['dumpster_01', 'cone_01', 'tree_02', 'lounge_01'],
};

// Quarter-turn rotation without trig, so every client places props identically (layout.ts rule).
const COS = [1, 0, -1, 0] as const;
const SIN = [0, 1, 0, -1] as const;
const cm = (v: number) => Math.round(v * 100) / 100;

/**
 * Deterministic street furniture for one district: same layout in, same props out, on every
 * client. Each lot gets its own seeded RNG (district slug + lot index), so one booth more doesn't
 * reshuffle the rest. Only ids in `available` are used.
 */
export function planDistrictProps(
  district: DistrictLayout,
  available: ReadonlySet<string>,
): PropPlacement[] {
  const decor = (PROP_SETS[district.theme] ?? PROP_SETS.default ?? []).filter((id) =>
    available.has(id),
  );
  const out: PropPlacement[] = [];
  district.lots.forEach((lot, i) => {
    const random = rng(hashString(`${district.slug}:${i}`));
    const halfW = (lot.span * LOT_W_M) / 2 - SIDE_INSET_M;
    const front = LOT_D_M / 2 + CURB_M;
    const c = COS[lot.facing];
    const s = SIN[lot.facing];
    const yaw = (lot.facing * Math.PI) / 2;
    const place = (id: string, lx: number) => {
      // Local +Z (the lot front) rotated by the facing: (lx, front) → world.
      out.push({ id, x: cm(lot.x + lx * c + front * s), z: cm(lot.z - lx * s + front * c), yaw });
    };
    if (i % 2 === 0 && available.has(STREET_LAMP)) place(STREET_LAMP, -halfW);
    if (decor.length > 0 && random() < DECOR_CHANCE) place(pick(random, decor), halfW);
  });
  return out;
}
