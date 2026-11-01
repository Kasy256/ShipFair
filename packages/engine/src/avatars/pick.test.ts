import { describe, expect, it } from 'vitest';
import { rayHitsCylinder } from './pick.ts';

const R = 0.45;
const H = 1.9;

describe('rayHitsCylinder', () => {
  it('hits a player straight ahead at their front surface', () => {
    // From 10 m away along −z, at chest height.
    expect(rayHitsCylinder(0, 1.2, 10, 0, 0, -1, 0, 0, 0, R, H)).toBeCloseTo(10 - R);
  });

  it('misses beside them, above their head and behind the camera', () => {
    expect(rayHitsCylinder(1, 1.2, 10, 0, 0, -1, 0, 0, 0, R, H)).toBe(Infinity);
    expect(rayHitsCylinder(0, 2.5, 10, 0, 0, -1, 0, 0, 0, R, H)).toBe(Infinity);
    expect(rayHitsCylinder(0, 1.2, 10, 0, 0, 1, 0, 0, 0, R, H)).toBe(Infinity);
  });

  it('hits from above through the top of the cylinder', () => {
    const d = Math.SQRT1_2;
    // Looking down at 45° from 3 m up and 3 m back: enters at the top cap.
    const t = rayHitsCylinder(0, H + 3, 3, 0, -d, -d, 0, 0, 0, R, H);
    expect(t).toBeCloseTo(3 / d);
  });

  it('returns 0 when the ray starts inside', () => {
    expect(rayHitsCylinder(0, 1, 0, 1, 0, 0, 0, 0, 0, R, H)).toBe(0);
  });
});
