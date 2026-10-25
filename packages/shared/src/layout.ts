import {
  DISTRICT_GAP_M,
  DISTRICT_GROW_AT,
  DISTRICT_INITIAL_STREETS,
  LOT_D_M,
  LOT_W_M,
  LOTS_PER_STREET_SIDE,
  PLAZA_SIZE_M,
  STREET_W_M,
} from './constants.ts';
import type { BoothPublic, BoothTier } from './schemas/booth.ts';
import type { District } from './schemas/district.ts';

// Deterministic city layout (ARCHITECTURE.md §4). Everything is integer centimetres internally and
// rotations are quarter turns, so the output is bit-identical on V8 and JSC. Outputs are metres.
//
// Districts form a pinwheel round the plaza: district i (by sortOrder) sits on side i % 4
// (N, E, S, W) in slot ⌊i / 4⌋, and grows outward one street at a time. In a district's local frame
// u points away from the plaza and v runs along it. A spine street runs along u at the low-v edge;
// each cross street runs along v with a row of lots on both sides.

/** Quarter turns. The front of something with facing f points along: 0 +z, 1 +x, 2 −z, 3 −x. */
export type Facing = 0 | 1 | 2 | 3;

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Lot {
  boothId: string | null;
  tier: BoothTier | null;
  /** Centre of the footprint. */
  x: number;
  z: number;
  /** Direction the booth's front (and its street) faces. */
  facing: Facing;
  /** Lots covered along the street: 2 for pavilions, else 1. */
  span: 1 | 2;
}

export interface DistrictLayout {
  id: number;
  slug: string;
  theme: string;
  /** Direction from the plaza toward the district's far end. */
  outward: Facing;
  /** World position of the district's local origin (plaza end of the spine street). */
  origin: { x: number; z: number };
  /** Local extents: `w` along the plaza, `d` away from it. */
  size: { w: number; d: number };
  rect: Rect;
  streetCount: number;
  /** The spine first, then cross streets from the plaza outward. */
  streets: Rect[];
  lots: Lot[];
}

export interface CityLayout {
  plaza: { rect: Rect; spawn: { x: number; z: number; yaw: number } };
  districts: DistrictLayout[];
  bounds: Rect;
  /** Booths whose district isn't in the snapshot. */
  unplaced: string[];
}

export type LayoutBooth = Pick<BoothPublic, 'id' | 'districtId' | 'approvedAt' | 'tier'>;
export type LayoutDistrict = Pick<District, 'id' | 'slug' | 'theme' | 'sortOrder'>;

const CM = 100;
const LOT_W = LOT_W_M * CM;
const LOT_D = LOT_D_M * CM;
const STREET_W = STREET_W_M * CM;
const PER_SIDE = LOTS_PER_STREET_SIDE;
const LOTS_PER_STREET = 2 * PER_SIDE;
const DISTRICT_W = STREET_W + PER_SIDE * LOT_W;
const STREET_BAND_D = 2 * LOT_D + STREET_W;
const SLOT_PITCH = DISTRICT_W + DISTRICT_GAP_M * CM;
const PLAZA_HALF = (PLAZA_SIZE_M * CM) / 2;
// Slot 0 is centred on its side. Every slot's v-range starts at −V_OVERHANG, and districts start at
// u = U_START > V_OVERHANG, so neighbouring sides can never overlap, however far they grow.
const V_OVERHANG = DISTRICT_W / 2;
const U_START = Math.max(PLAZA_HALF + STREET_W, V_OVERHANG + STREET_W);
const GROW_AT_PCT = Math.round(DISTRICT_GROW_AT * 100);

const m = (cm: number): number => cm / CM;

/** Local (u, v) in cm → world [x, z] in cm, for a district facing `q`. */
function toWorld(q: Facing, u: number, v: number): [number, number] {
  switch (q) {
    case 0:
      return [v, u];
    case 1:
      return [u, -v];
    case 2:
      return [-v, -u];
    case 3:
      return [-u, v];
  }
}

function localRect(q: Facing, u0: number, u1: number, v0: number, v1: number): Rect {
  const [ax, az] = toWorld(q, u0, v0);
  const [bx, bz] = toWorld(q, u1, v1);
  return {
    minX: m(Math.min(ax, bx)),
    minZ: m(Math.min(az, bz)),
    maxX: m(Math.max(ax, bx)),
    maxZ: m(Math.max(az, bz)),
  };
}

// Lot slots are numbered so the fill order runs street by street, then outward along the street
// from the spine, alternating sides: slot = street * 12 + along * 2 + side.

interface Placement {
  booth: LayoutBooth;
  slot: number;
  span: 1 | 2;
}

function findSlot(taken: boolean[], capacity: number, span: 1 | 2): number {
  for (let slot = 0; slot < capacity; slot++) {
    if (taken[slot]) continue;
    if (span === 1) return slot;
    const along = (slot % LOTS_PER_STREET) >> 1;
    // A pavilion takes this lot and the next one along the same side of the same street.
    if (along + 1 < PER_SIDE && !taken[slot + 2]) return slot;
  }
  return -1;
}

/** Assigns booths (already in fill order) to slots and returns how many streets that needs. */
function fillDistrict(booths: readonly LayoutBooth[]): {
  streets: number;
  placements: Placement[];
} {
  let streets = DISTRICT_INITIAL_STREETS;
  let used = 0;
  const taken: boolean[] = [];
  const placements: Placement[] = [];
  for (const booth of booths) {
    const span = booth.tier === 'pavilion' ? 2 : 1;
    let slot = findSlot(taken, streets * LOTS_PER_STREET, span);
    // Guard only: growing at 80% always leaves a free pair today, but not if DISTRICT_GROW_AT rises.
    while (slot < 0) {
      streets++;
      slot = findSlot(taken, streets * LOTS_PER_STREET, span);
    }
    taken[slot] = true;
    if (span === 2) taken[slot + 2] = true;
    used += span;
    placements.push({ booth, slot, span });
    while (used * 100 >= GROW_AT_PCT * streets * LOTS_PER_STREET) streets++;
  }
  return { streets, placements };
}

function lotAt(q: Facing, v0: number, slot: number, span: 1 | 2, booth: LayoutBooth | null): Lot {
  const street = Math.floor(slot / LOTS_PER_STREET);
  const along = (slot % LOTS_PER_STREET) >> 1;
  const side = slot & 1;
  const bandStart = U_START + street * STREET_BAND_D;
  // Side 0 is the plaza side of the street and faces outward (+u); side 1 faces back (−u).
  const u = side === 0 ? bandStart + LOT_D / 2 : bandStart + LOT_D + STREET_W + LOT_D / 2;
  const v = v0 + STREET_W + along * LOT_W + (span * LOT_W) / 2;
  const [x, z] = toWorld(q, u, v);
  return {
    boothId: booth?.id ?? null,
    tier: booth?.tier ?? null,
    x: m(x),
    z: m(z),
    facing: (side === 0 ? q : (q + 2) % 4) as Facing,
    span,
  };
}

function layoutDistrict(
  district: LayoutDistrict,
  ringIndex: number,
  booths: readonly LayoutBooth[],
): DistrictLayout {
  const q = (ringIndex % 4) as Facing;
  const v0 = -V_OVERHANG + Math.floor(ringIndex / 4) * SLOT_PITCH;
  const { streets, placements } = fillDistrict(booths);
  const depth = streets * STREET_BAND_D;

  const bySlot = new Map<number, Placement>();
  for (const placement of placements) bySlot.set(placement.slot, placement);
  const lots: Lot[] = [];
  const covered = new Set<number>();
  for (let slot = 0; slot < streets * LOTS_PER_STREET; slot++) {
    if (covered.has(slot)) continue;
    const placement = bySlot.get(slot);
    if (placement?.span === 2) covered.add(slot + 2);
    lots.push(lotAt(q, v0, slot, placement?.span ?? 1, placement?.booth ?? null));
  }

  const streetRects = [localRect(q, U_START, U_START + depth, v0, v0 + STREET_W)];
  for (let s = 0; s < streets; s++) {
    const u = U_START + s * STREET_BAND_D + LOT_D;
    streetRects.push(localRect(q, u, u + STREET_W, v0 + STREET_W, v0 + DISTRICT_W));
  }

  const [ox, oz] = toWorld(q, U_START, v0);
  return {
    id: district.id,
    slug: district.slug,
    theme: district.theme,
    outward: q,
    origin: { x: m(ox), z: m(oz) },
    size: { w: m(DISTRICT_W), d: m(depth) },
    rect: localRect(q, U_START, U_START + depth, v0, v0 + DISTRICT_W),
    streetCount: streets,
    streets: streetRects,
    lots,
  };
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Same input, same city, on every client and the server. Input order doesn't matter. */
export function layoutCity(
  districts: readonly LayoutDistrict[],
  booths: readonly LayoutBooth[],
): CityLayout {
  const ring = [...districts].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const byDistrict = new Map<number, LayoutBooth[]>(ring.map((d) => [d.id, []]));
  const unplaced: string[] = [];
  const seen = new Set<string>();

  // Schemas guarantee valid timestamps; the fallback only keeps the comparator consistent.
  const approvedMs = new Map(booths.map((b) => [b.id, Date.parse(b.approvedAt) || 0]));
  const ordered = [...booths].sort(
    (a, b) =>
      (approvedMs.get(a.id) ?? 0) - (approvedMs.get(b.id) ?? 0) || compareStrings(a.id, b.id),
  );
  for (const booth of ordered) {
    if (seen.has(booth.id)) continue;
    seen.add(booth.id);
    const list = byDistrict.get(booth.districtId);
    if (list) list.push(booth);
    else unplaced.push(booth.id);
  }

  const plazaRect: Rect = {
    minX: m(-PLAZA_HALF),
    minZ: m(-PLAZA_HALF),
    maxX: m(PLAZA_HALF),
    maxZ: m(PLAZA_HALF),
  };
  const laidOut = ring.map((d, i) => layoutDistrict(d, i, byDistrict.get(d.id) ?? []));
  const bounds = { ...plazaRect };
  for (const { rect } of laidOut) {
    bounds.minX = Math.min(bounds.minX, rect.minX);
    bounds.minZ = Math.min(bounds.minZ, rect.minZ);
    bounds.maxX = Math.max(bounds.maxX, rect.maxX);
    bounds.maxZ = Math.max(bounds.maxZ, rect.maxZ);
  }

  return {
    plaza: { rect: plazaRect, spawn: { x: 0, z: 0, yaw: 0 } },
    districts: laidOut,
    bounds,
    unplaced: unplaced.sort(compareStrings),
  };
}
