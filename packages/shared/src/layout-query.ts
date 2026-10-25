import { BOOTH_GRID_CELL_M, LOT_D_M, SPAWN_DISTANCE_M } from './constants.ts';
import type { CityLayout, DistrictLayout, Facing, Lot } from './layout.ts';

/** The point visitors walk up to: the middle of a booth's street-side edge. */
export interface BoothAnchor {
  readonly boothId: string;
  readonly districtId: number;
  readonly lot: Lot;
  readonly x: number;
  readonly z: number;
}

interface LayoutIndex {
  readonly anchors: Map<string, BoothAnchor>;
  readonly grid: Map<number, BoothAnchor[]>;
  /** Occupied cell range, so a query never walks cells outside the city. */
  readonly minCx: number;
  readonly maxCx: number;
  readonly minCz: number;
  readonly maxCz: number;
}

const CM = 100;
const QUARTER_TURN = Math.PI / 2;
// Unit front vectors per facing, as [dx, dz].
const FRONT: Readonly<Record<Facing, readonly [number, number]>> = {
  0: [0, 1],
  1: [1, 0],
  2: [0, -1],
  3: [-1, 0],
};
const GRID_OFFSET = 32768; // cells per axis either side of the origin (±262 km at 8 m)
const GRID_STRIDE = 2 * GRID_OFFSET;

const cellOf = (metres: number): number => Math.floor(metres / BOOTH_GRID_CELL_M);
const cellKey = (cx: number, cz: number): number =>
  (cx + GRID_OFFSET) * GRID_STRIDE + (cz + GRID_OFFSET);
const roundCm = (metres: number): number => Math.round(metres * CM) / CM;

/** Front-edge point `distanceM` beyond the lot's front edge, rounded to whole cm. */
function inFront(lot: Lot, distanceM: number): { x: number; z: number } {
  const [dx, dz] = FRONT[lot.facing];
  const reach = LOT_D_M / 2 + distanceM;
  return { x: roundCm(lot.x + dx * reach), z: roundCm(lot.z + dz * reach) };
}

// Layouts are immutable values, so the index is built once per layout object and cached.
const indexes = new WeakMap<CityLayout, LayoutIndex>();

function getIndex(layout: CityLayout): LayoutIndex {
  const cached = indexes.get(layout);
  if (cached) return cached;
  const anchors = new Map<string, BoothAnchor>();
  const grid = new Map<number, BoothAnchor[]>();
  let minCx = Number.POSITIVE_INFINITY;
  let maxCx = Number.NEGATIVE_INFINITY;
  let minCz = Number.POSITIVE_INFINITY;
  let maxCz = Number.NEGATIVE_INFINITY;
  for (const district of layout.districts) {
    for (const lot of district.lots) {
      if (lot.boothId === null) continue;
      const { x, z } = inFront(lot, 0);
      const anchor: BoothAnchor = { boothId: lot.boothId, districtId: district.id, lot, x, z };
      anchors.set(lot.boothId, anchor);
      const cx = cellOf(x);
      const cz = cellOf(z);
      minCx = Math.min(minCx, cx);
      maxCx = Math.max(maxCx, cx);
      minCz = Math.min(minCz, cz);
      maxCz = Math.max(maxCz, cz);
      const key = cellKey(cx, cz);
      const cell = grid.get(key);
      if (cell) cell.push(anchor);
      else grid.set(key, [anchor]);
    }
  }
  const index = { anchors, grid, minCx, maxCx, minCz, maxCz };
  indexes.set(layout, index);
  return index;
}

export function boothAnchor(layout: CityLayout, boothId: string): BoothAnchor | null {
  return getIndex(layout).anchors.get(boothId) ?? null;
}

/** Where a `/b/:slug` visitor appears: 5 m in front of the booth, facing it. Yaw per `Facing`. */
export function spawnForBooth(
  layout: CityLayout,
  boothId: string,
): { x: number; z: number; yaw: number } | null {
  const anchor = getIndex(layout).anchors.get(boothId);
  if (!anchor) return null;
  const { x, z } = inFront(anchor.lot, SPAWN_DISTANCE_M);
  return { x, z, yaw: ((anchor.lot.facing + 2) % 4) * QUARTER_TURN };
}

/** The district whose rect contains the point (min edges inclusive), or null (plaza, streets out of town). */
export function districtAt(layout: CityLayout, x: number, z: number): DistrictLayout | null {
  for (const district of layout.districts) {
    const { rect } = district;
    if (x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ) return district;
  }
  return null;
}

/**
 * The closest booth anchor within `radius` metres, ties broken by booth id. Uses the spatial grid
 * and returns a cached object, so it allocates nothing and is safe to call every frame.
 */
export function nearestBooth(
  layout: CityLayout,
  x: number,
  z: number,
  radius: number,
): BoothAnchor | null {
  if (!(radius >= 0) || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const { grid, minCx, maxCx, minCz, maxCz } = getIndex(layout);
  const maxSq = radius * radius;
  let best: BoothAnchor | null = null;
  let bestSq = Number.POSITIVE_INFINITY;
  // Clamp to occupied cells: a huge (or infinite) radius costs at most one pass over the grid.
  const cx0 = Math.max(cellOf(x - radius), minCx);
  const cx1 = Math.min(cellOf(x + radius), maxCx);
  const cz0 = Math.max(cellOf(z - radius), minCz);
  const cz1 = Math.min(cellOf(z + radius), maxCz);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const cell = grid.get(cellKey(cx, cz));
      if (!cell) continue;
      for (const anchor of cell) {
        const dx = anchor.x - x;
        const dz = anchor.z - z;
        const sq = dx * dx + dz * dz;
        if (sq > maxSq) continue;
        if (sq < bestSq || (sq === bestSq && best !== null && anchor.boothId < best.boothId)) {
          best = anchor;
          bestSq = sq;
        }
      }
    }
  }
  return best;
}
