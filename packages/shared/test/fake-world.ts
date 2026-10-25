import type { LayoutBooth } from '../src/layout.ts';
import { pick, type Rng, rng } from '../src/rng.ts';
import type { BoothTier } from '../src/schemas/booth.ts';
import type { District } from '../src/schemas/district.ts';

export const DISTRICTS: District[] = [
  ['ai-agents', 'AI Agents', '#7c3aed'],
  ['dev-tools', 'Dev Tools', '#0ea5e9'],
  ['productivity', 'Productivity & SaaS', '#22c55e'],
  ['design', 'Design', '#f97316'],
  ['marketing', 'Marketing', '#ec4899'],
  ['finance-ops', 'Finance & Ops', '#eab308'],
  ['games-fun', 'Games & Fun', '#ef4444'],
  ['weird', 'Weird & Wonderful', '#14b8a6'],
].map(([slug, name, color], i) => ({
  id: i + 1,
  slug: slug as string,
  name: name as string,
  theme: slug as string,
  color: color as string,
  sortOrder: i * 10,
}));

const hex = (random: Rng, n: number): string =>
  Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join('');

export const fakeUuid = (random: Rng): string =>
  `${hex(random, 8)}-${hex(random, 4)}-4${hex(random, 3)}-8${hex(random, 3)}-${hex(random, 12)}`;

const BASE_MS = Date.UTC(2026, 9, 1);
const MINUTE_MS = 60_000;

/** `count` booths spread over `districts`, ~4% pavilions, ~20% booths, some equal timestamps. */
export function fakeBooths(count: number, seed: number, districts = DISTRICTS): LayoutBooth[] {
  const random = rng(seed);
  const tiers: BoothTier[] = ['stall', 'stall', 'stall', 'booth'];
  return Array.from({ length: count }, (_, i) => ({
    id: fakeUuid(random),
    districtId: pick(random, districts).id,
    // Every fifth booth shares its timestamp with the previous one, to exercise the id tiebreak.
    approvedAt: new Date(BASE_MS + (i - (i % 5 === 4 ? 1 : 0)) * MINUTE_MS).toISOString(),
    tier: random() < 0.04 ? 'pavilion' : pick(random, tiers),
  }));
}

export function booth(
  id: string,
  districtId: number,
  minute: number,
  tier: BoothTier = 'stall',
): LayoutBooth {
  return { id, districtId, approvedAt: new Date(BASE_MS + minute * MINUTE_MS).toISOString(), tier };
}
