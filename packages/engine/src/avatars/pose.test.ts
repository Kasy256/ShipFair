import { RUN_SPEED_MPS, WALK_SPEED_MPS } from '@shipfair/shared';
import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, LAND_SQUASH_S } from '../config.ts';
import {
  advancePose,
  createPose,
  createPoseState,
  HIPS_HEIGHT_M,
  startLand,
  startWave,
} from './pose.ts';

const run = (speed: number, seconds: number, isGrounded = true, vy = 0) => {
  const state = createPoseState();
  const pose = createPose();
  let steps = 0;
  for (let i = 0; i < Math.round(seconds / FIXED_DT_S); i++) {
    if (advancePose(state, { speed, isGrounded, vy }, FIXED_DT_S, i * FIXED_DT_S, pose)) steps++;
  }
  return { state, pose, steps };
};

describe('advancePose', () => {
  it('stands still with idle breathing and no footsteps', () => {
    const { pose, steps } = run(0, 2);
    expect(steps).toBe(0);
    expect(pose.hip0).toBeCloseTo(0, 9);
    expect(Math.abs(pose.chestScaleY - 1)).toBeLessThanOrEqual(0.01);
  });

  it('is deterministic: same inputs, same pose', () => {
    expect(run(3, 1.3).pose).toEqual(run(3, 1.3).pose);
  });

  it('steps faster when running than walking', () => {
    const walk = run(WALK_SPEED_MPS, 4).steps;
    const sprint = run(RUN_SPEED_MPS, 4).steps;
    expect(walk).toBeGreaterThan(4);
    expect(sprint).toBeGreaterThan(walk);
  });

  it('tucks the legs in the air', () => {
    const rising = run(2, 0.1, false, 5).pose;
    expect(rising.knee1).toBeCloseTo(1.3, 9);
    const falling = run(2, 0.1, false, -5).pose;
    expect(falling.knee0).toBeCloseTo(0.6, 9);
  });

  it('squashes on landing and raises an arm to wave', () => {
    const state = createPoseState();
    const pose = createPose();
    startLand(state);
    advancePose(state, { speed: 0, isGrounded: true, vy: 0 }, 0, 0, pose);
    expect(pose.hipsY).toBeCloseTo(HIPS_HEIGHT_M - LAND_SQUASH_S * 0.6, 9);
    startWave(state);
    advancePose(state, { speed: 0, isGrounded: true, vy: 0 }, FIXED_DT_S, 0, pose);
    expect(pose.shoulderZ0).toBe(2.6);
  });
});
