import { rng } from '@shipfair/shared';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createMat, setChild, setRoot, writeMat } from './limb-matrix.ts';

const UP = new Vector3(0, 1, 0);

function expectSame(mine: Float64Array | Float32Array, three: Matrix4, offset = 0): void {
  for (let i = 0; i < 16; i++) expect(mine[offset + i]).toBeCloseTo(three.elements[i] ?? 0, 6);
}

describe('limb matrices', () => {
  it('match three for root · translate · Euler(x, 0, z), at random poses', () => {
    const random = rng(4);
    const r = () => (random() - 0.5) * 8;
    for (let n = 0; n < 200; n++) {
      const [x, y, z, yaw, tx, ty, tz, ax, az] = [r(), r(), r(), r(), r(), r(), r(), r(), r()];
      const root = createMat();
      setRoot(root, x, y, z, yaw);
      const threeRoot = new Matrix4().compose(
        new Vector3(x, y, z),
        new Quaternion().setFromAxisAngle(UP, yaw),
        new Vector3(1, 1, 1),
      );
      expectSame(root, threeRoot);
      const joint = createMat();
      setChild(joint, root, tx, ty, tz, ax, az);
      const threeJoint = threeRoot
        .clone()
        .multiply(new Matrix4().makeTranslation(tx, ty, tz))
        .multiply(new Matrix4().makeRotationFromEuler(new Euler(ax, 0, az)));
      expectSame(joint, threeJoint);
      // A grandchild (the shin under the thigh).
      const shin = createMat();
      setChild(shin, joint, 0, -0.45, 0, ax * 0.5, 0);
      const threeShin = threeJoint
        .clone()
        .multiply(new Matrix4().makeTranslation(0, -0.45, 0))
        .multiply(new Matrix4().makeRotationX(ax * 0.5));
      expectSame(shin, threeShin);
    }
  });

  it('writes a matrix into an instance buffer slot', () => {
    const target = new Float32Array(48);
    const m = createMat();
    setRoot(m, 1, 2, 3, 0);
    writeMat(target, 2, m);
    expect(Array.from(target.slice(32, 48), (v) => v + 0)).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1,
    ]);
    expect(target[31]).toBe(0);
  });
});
