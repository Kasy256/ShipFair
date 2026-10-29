import { describe, expect, it } from 'vitest';
import { arrowAngle, minimapMatrix } from './minimap.ts';

const apply = (m: Float64Array, x: number, z: number) => ({
  x: (m[0] ?? 0) * x + (m[2] ?? 0) * z + (m[4] ?? 0),
  y: (m[1] ?? 0) * x + (m[3] ?? 0) * z + (m[5] ?? 0),
});

describe('minimapMatrix', () => {
  const m = new Float64Array(6);

  it.each([0, Math.PI / 2, Math.PI, -0.7, 2.3])(
    'puts the player in the centre, the look direction up and the right side right (yaw %f)',
    (yaw) => {
      const view = { x: 12, z: -30, cameraYaw: yaw };
      minimapMatrix(view, 2, 80, 80, m);
      const centre = apply(m, view.x, view.z);
      expect(centre.x).toBeCloseTo(80);
      expect(centre.y).toBeCloseTo(80);
      const ahead = apply(m, view.x + Math.sin(yaw) * 10, view.z + Math.cos(yaw) * 10);
      expect(ahead.x).toBeCloseTo(80);
      expect(ahead.y).toBeCloseTo(60);
      // Right of the look direction (y up, yaw turns +z toward +x) is (-cos, sin).
      const right = apply(m, view.x - Math.cos(yaw) * 10, view.z + Math.sin(yaw) * 10);
      expect(right.x).toBeCloseTo(100);
      expect(right.y).toBeCloseTo(80);
    },
  );
});

describe('arrowAngle', () => {
  it('is 0 when the avatar faces where the camera looks, and a quarter turn for a side', () => {
    expect(arrowAngle(1.2, 1.2)).toBe(0);
    // Facing the camera's right: (-cos c, sin c) is the look of yaw c - π/2.
    expect(arrowAngle(0.4 - Math.PI / 2, 0.4)).toBeCloseTo(Math.PI / 2);
  });
});
