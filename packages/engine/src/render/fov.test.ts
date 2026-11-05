import { describe, expect, it } from 'vitest';
import { CAMERA_MAX_VFOV_DEG, CAMERA_MIN_HFOV_DEG } from '../config.ts';
import { fovForAspect, horizontalFov } from './fov.ts';

describe('fovForAspect', () => {
  it('keeps the chosen FOV in landscape and on square screens', () => {
    expect(fovForAspect(62, 16 / 9)).toBe(62);
    expect(fovForAspect(75, 1)).toBe(75);
  });

  it('widens a portrait phone until the horizontal FOV reaches the minimum', () => {
    const aspect = 600 / 820; // a small tablet in portrait: reachable under the cap
    const v = fovForAspect(62, aspect);
    expect(v).toBeGreaterThan(62);
    expect(horizontalFov(v, aspect)).toBeCloseTo(CAMERA_MIN_HFOV_DEG, 6);
  });

  it(`caps at ${CAMERA_MAX_VFOV_DEG}° on very tall screens, never below the chosen FOV`, () => {
    const phone = 390 / 844;
    expect(fovForAspect(62, phone)).toBe(CAMERA_MAX_VFOV_DEG);
    expect(horizontalFov(fovForAspect(62, phone), phone)).toBeGreaterThan(40);
    expect(fovForAspect(88, phone)).toBe(88);
  });

  it('ignores a zero or invalid aspect', () => {
    expect(fovForAspect(62, 0)).toBe(62);
    expect(fovForAspect(62, Number.NaN)).toBe(62);
  });
});
