import type { LayoutBooth } from '../src/layout.ts';
import { pick, type Rng, rng } from '../src/rng.ts';
import type { BoothMedia, BoothPricing, BoothPublic, BoothTier } from '../src/schemas/booth.ts';
import type { District } from '../src/schemas/district.ts';
import type { WorldSnapshot } from '../src/schemas/world.ts';

// Fake cities for tests, `?debug=fake500` and `tools/fake-world.ts`. Same seed, same world.

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

/** The three districts open at launch (PRODUCT.md v1). */
export const LAUNCH_DISTRICTS: District[] = DISTRICTS.slice(0, 3);

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

const FIRST = ['Quantum', 'Tiny', 'Lazy', 'Bright', 'Pixel', 'Shadow', 'Cosmic', 'Rapid', 'Quiet'];
const SECOND = ['Ledger', 'Pilot', 'Forge', 'Notes', 'Kite', 'Relay', 'Garden', 'Lens', 'Otter'];
const SUFFIX = ['', ' AI', ' HQ', '.dev', ' Pro', ' Kit', ' Labs'];
const PRICING: BoothPricing[] = ['free', 'freemium', 'paid', 'open-source'];
/** Distinct fake images; keys repeat across booths like popular templates would. */
export const FAKE_LOGOS = 12;
export const FAKE_SHOTS = 16;
export const FAKE_SHOT_PX = { w: 1280, h: 720 } as const;

/** One fake approved booth. `index` makes the slug unique and orders `approvedAt`. */
export function fakeBooth(random: Rng, index: number, districts: readonly District[]): BoothPublic {
  const name = `${pick(random, FIRST)} ${pick(random, SECOND)}${pick(random, SUFFIX)}`;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index}`.slice(0, 40);
  const shots = 1 + Math.floor(random() * 3);
  const media: BoothMedia[] = Array.from({ length: shots }, () => ({
    type: 'image',
    key: `fake/shot-${Math.floor(random() * FAKE_SHOTS)}.png`,
    w: FAKE_SHOT_PX.w,
    h: FAKE_SHOT_PX.h,
  }));
  const roll = random();
  const tier: BoothTier = roll < 0.04 ? 'pavilion' : roll < 0.24 ? 'booth' : 'stall';
  return {
    id: fakeUuid(random),
    ownerId: fakeUuid(random),
    slug,
    name,
    tagline: `${name} helps makers ship faster.`,
    description: null,
    url: `https://example.com/${slug}`,
    districtId: pick(random, districts).id,
    logoKey: random() < 0.85 ? `fake/logo-${Math.floor(random() * FAKE_LOGOS)}.png` : null,
    media,
    pricing: pick(random, PRICING),
    tier,
    approvedAt: new Date(BASE_MS + index * MINUTE_MS).toISOString(),
  };
}

/** A `/api/world`-shaped snapshot with `count` booths over the launch districts. */
export function fakeWorld(
  count: number,
  seed = 1,
  districts: readonly District[] = LAUNCH_DISTRICTS,
): WorldSnapshot {
  const random = rng(seed);
  return {
    version: 1,
    generatedAt: new Date(BASE_MS).toISOString(),
    districts: [...districts],
    booths: Array.from({ length: count }, (_, i) => fakeBooth(random, i, districts)),
    makers: [],
  };
}

/** `count` more booths approved after every booth of `fakeWorld(…, seed)` (for updateBooths). */
export function fakeLateBooths(
  count: number,
  seed: number,
  after: number,
  districts: readonly District[] = LAUNCH_DISTRICTS,
): BoothPublic[] {
  const random = rng(seed ^ 0x5f3759df);
  return Array.from({ length: count }, (_, i) => fakeBooth(random, after + i, districts));
}
