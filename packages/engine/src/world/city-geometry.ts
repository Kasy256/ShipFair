import {
  type CityLayout,
  type DistrictLayout,
  type Facing,
  PLAZA_SIZE_M,
  type Rect,
  STREET_W_M,
} from '@shipfair/shared';

// Pure helpers over a CityLayout: where district entrances are, which way is out, and the ring
// road. Quarter turns only (lookup tables, no trig), like layout.ts.

export interface Dir {
  readonly x: number;
  readonly z: number;
}

/** Unit front vector per facing: 0 +z, 1 +x, 2 −z, 3 −x. */
export const FRONT: Readonly<Record<Facing, Dir>> = {
  0: { x: 0, z: 1 },
  1: { x: 1, z: 0 },
  2: { x: 0, z: -1 },
  3: { x: -1, z: 0 },
};
/** A district's local +v (along the plaza) per outward facing (layout.ts `toWorld`). */
const LATERAL: Readonly<Record<Facing, Dir>> = {
  0: { x: 1, z: 0 },
  1: { x: 0, z: -1 },
  2: { x: -1, z: 0 },
  3: { x: 0, z: 1 },
};
const QUARTER_TURN = Math.PI / 2;

export interface DistrictFrame {
  /** From the plaza toward the far end. */
  readonly outward: Dir;
  /** Along the plaza, from the spine street across the district. */
  readonly lateral: Dir;
  /** Centre of the spine street where it meets the ring road (the gate). */
  readonly entrance: Dir;
  /** Centre of the spine street at the district's far end. */
  readonly spineEnd: Dir;
  /** Yaw that faces outward. */
  readonly yaw: number;
}

export function districtFrame(district: DistrictLayout): DistrictFrame {
  const outward = FRONT[district.outward];
  const lateral = LATERAL[district.outward];
  const half = STREET_W_M / 2;
  const entrance = {
    x: district.origin.x + lateral.x * half,
    z: district.origin.z + lateral.z * half,
  };
  return {
    outward,
    lateral,
    entrance,
    spineEnd: {
      x: entrance.x + outward.x * district.size.d,
      z: entrance.z + outward.z * district.size.d,
    },
    yaw: district.outward * QUARTER_TURN,
  };
}

/** Distance from the origin to the inner edge of the nearest district (the ring road's outside). */
export function ringOuterM(layout: CityLayout): number {
  let inner = Number.POSITIVE_INFINITY;
  for (const d of layout.districts) {
    const o = FRONT[d.outward];
    inner = Math.min(inner, d.origin.x * o.x + d.origin.z * o.z);
  }
  return Number.isFinite(inner) ? inner : PLAZA_SIZE_M / 2 + STREET_W_M;
}

/** The ring road round the plaza as four non-overlapping rects. */
export function ringRoad(layout: CityLayout): Rect[] {
  const a = PLAZA_SIZE_M / 2;
  const b = ringOuterM(layout);
  return [
    { minX: -b, maxX: b, minZ: a, maxZ: b },
    { minX: -b, maxX: b, minZ: -b, maxZ: -a },
    { minX: a, maxX: b, minZ: -a, maxZ: a },
    { minX: -b, maxX: -a, minZ: -a, maxZ: a },
  ];
}
