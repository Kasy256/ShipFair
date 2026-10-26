// The prompt-04 test level as plain data, so physics, rendering and the e2e probes all read the
// same numbers. Prompt 05 replaces it with the real city.

export interface LevelBox {
  /** Axis-aligned bounds in metres. */
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  color: number;
  kind: 'floor' | 'wall' | 'crate' | 'step' | 'platform';
}

export interface LevelCylinder {
  center: readonly [number, number, number];
  radius: number;
  halfHeight: number;
  color: number;
}

/** A wedge rising along +z from `z0` (height 0) to `z1` (height `height`). */
export interface LevelRamp {
  x: number;
  halfWidth: number;
  z0: number;
  z1: number;
  height: number;
  color: number;
}

export interface TestLevelLayout {
  boxes: readonly LevelBox[];
  cylinders: readonly LevelCylinder[];
  ramps: readonly LevelRamp[];
  spawn: { x: number; y: number; z: number; yaw: number };
  /** Start of the staircase walk used by the e2e step test (walk toward +z). */
  stairsStart: { x: number; z: number };
  platformTopY: number;
}

const HALF_SIZE_M = 30;
const WALL_H_M = 3;
const STEP_RISE_M = 0.3;
const STEP_RUN_M = 0.4;
const PLATFORM_TOP_M = 1.2;

const COLORS = {
  floor: 0x8a8f9c,
  wall: 0xd9d4cc,
  crate: 0xe3a857,
  step: 0x7c9cc9,
  platform: 0x5b7fb5,
  ramp: 0x9cc97c,
  pillar: 0xc97c9c,
} as const;

const box = (
  kind: LevelBox['kind'],
  min: [number, number, number],
  max: [number, number, number],
): LevelBox => ({ kind, min, max, color: COLORS[kind] });

function stairs(x0: number, x1: number, zStart: number): LevelBox[] {
  const out: LevelBox[] = [];
  const count = Math.round(PLATFORM_TOP_M / STEP_RISE_M) - 1; // the platform is the last riser
  for (let i = 0; i < count; i++) {
    const z = zStart + i * STEP_RUN_M;
    out.push(box('step', [x0, 0, z], [x1, (i + 1) * STEP_RISE_M, z + STEP_RUN_M]));
  }
  return out;
}

export function testLevelLayout(): TestLevelLayout {
  const h = HALF_SIZE_M;
  const t = 0.4; // perimeter wall thickness
  const stairsZ = 10.8;
  const platformZ = stairsZ + 3 * STEP_RUN_M;
  return {
    boxes: [
      box('floor', [-h, -1, -h], [h, 0, h]),
      // perimeter
      box('wall', [-h, 0, -h - t], [h, WALL_H_M, -h]),
      box('wall', [-h, 0, h], [h, WALL_H_M, h + t]),
      box('wall', [-h - t, 0, -h], [-h, WALL_H_M, h]),
      box('wall', [h, 0, -h], [h + t, WALL_H_M, h]),
      // interior walls of several thicknesses for the tunnelling probes
      box('wall', [-14, 0, -10.15], [6, WALL_H_M, -9.85]),
      box('wall', [10, 0, -18], [10.2, WALL_H_M, -2]),
      box('wall', [-22, 0, -4], [-21, WALL_H_M, 6]),
      box('wall', [-6, 0, -22], [6, 2, -21.5]),
      // crates: one low enough to step onto (0.4 m), the rest blockers
      box('crate', [2, 0, 2], [3, 1, 3]),
      box('crate', [-4, 0, 3], [-2.5, 1.5, 4.5]),
      box('crate', [4, 0, -4], [6, 0.4, -2]),
      box('crate', [-8, 0, -6], [-7, 2.5, -5]),
      box('crate', [16, 0, -8], [18, 1.2, -6]),
      // staircase (0.3 m risers, 0.4 m treads) onto a 1.2 m platform
      ...stairs(10.5, 13.5, stairsZ),
      box('platform', [10, 0, platformZ], [14, PLATFORM_TOP_M, platformZ + 6]),
      // a platform reached by the ramp
      box('platform', [-15, 0, 14], [-9, PLATFORM_TOP_M, 20]),
    ],
    cylinders: [{ center: [-4, 1.5, -14], radius: 0.6, halfHeight: 1.5, color: COLORS.pillar }],
    ramps: [
      // 1.2 m over 3.6 m, about 18°: walkable
      { x: -12, halfWidth: 1.5, z0: 10.4, z1: 14, height: PLATFORM_TOP_M, color: COLORS.ramp },
    ],
    spawn: { x: 0, y: 0, z: 8, yaw: Math.PI },
    stairsStart: { x: 12, z: 7 },
    platformTopY: PLATFORM_TOP_M,
  };
}
