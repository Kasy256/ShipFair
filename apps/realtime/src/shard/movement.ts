import { MAX_SPEED_MPS, MOVE_SLACK_M, type Rect } from '@shipfair/shared';
import { BOUNDS_MARGIN_M, MAX_Y_M, MIN_Y_M, MOVE_SPEED_FACTOR } from '../limits.ts';

// Movement validation (ARCHITECTURE.md §7 trust model). Clients own their movement; the server
// only refuses moves that are too fast or leave the city. Positions here are metres.

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Furthest a player may go in `elapsedS` seconds of server receive time:
 * `MAX_SPEED_MPS × elapsed × 1.25 + 0.5 m`. The slack absorbs network bunching.
 */
export function maxStepM(elapsedS: number): number {
  return MAX_SPEED_MPS * Math.max(0, elapsedS) * MOVE_SPEED_FACTOR + MOVE_SLACK_M;
}

/** True when `to` is reachable from `from` in `elapsedS` (3D distance, so jumps count). */
export function isReachable(from: Vec3, to: Vec3, elapsedS: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const limit = maxStepM(elapsedS);
  return dx * dx + dy * dy + dz * dz <= limit * limit;
}

/** Inside the city bounds (plus a margin) and a sane height band. */
export function isInBounds(bounds: Rect, p: Vec3): boolean {
  return (
    p.x >= bounds.minX - BOUNDS_MARGIN_M &&
    p.x <= bounds.maxX + BOUNDS_MARGIN_M &&
    p.z >= bounds.minZ - BOUNDS_MARGIN_M &&
    p.z <= bounds.maxZ + BOUNDS_MARGIN_M &&
    p.y >= MIN_Y_M &&
    p.y <= MAX_Y_M
  );
}
