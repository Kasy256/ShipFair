// Stand-in limb matrices without three's Matrix4 calls. In the allocation profile, every
// `makeTranslation`, `makeRotationX`, `multiplyMatrices` and Euler change boxed the doubles it was
// passed, about 80 bytes a frame for a crowd. These functions do the same column-major affine
// maths on plain numbers and typed arrays, so posing allocates nothing.

/** A 4×4 column-major matrix (only the affine part is used; row 3 stays 0 0 0 1). */
export type Mat = Float64Array;

export const createMat = (): Mat => {
  const m = new Float64Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
};

/** `out` = translation (x, y, z) · rotation about +y by `yaw` (a player's root). */
export function setRoot(out: Mat, x: number, y: number, z: number, yaw: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[0] = c;
  out[1] = 0;
  out[2] = -s;
  out[4] = 0;
  out[5] = 1;
  out[6] = 0;
  out[8] = s;
  out[9] = 0;
  out[10] = c;
  out[12] = x;
  out[13] = y;
  out[14] = z;
}

/**
 * `out` = `parent` · translation (tx, ty, tz) · Rx(ax) · Rz(az): a joint at (tx, ty, tz) in its
 * parent, rotated like three's Euler(ax, 0, az) in XYZ order. `out` may not be `parent`.
 */
export function setChild(
  out: Mat,
  parent: Mat,
  tx: number,
  ty: number,
  tz: number,
  ax: number,
  az: number,
): void {
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cz = Math.cos(az);
  const sz = Math.sin(az);
  // Local rotation Rx · Rz, column by column.
  const l0 = cz;
  const l1 = cx * sz;
  const l2 = sx * sz;
  const l4 = -sz;
  const l5 = cx * cz;
  const l6 = sx * cz;
  const l9 = -sx;
  const l10 = cx;
  const p0 = parent[0] ?? 1;
  const p1 = parent[1] ?? 0;
  const p2 = parent[2] ?? 0;
  const p4 = parent[4] ?? 0;
  const p5 = parent[5] ?? 1;
  const p6 = parent[6] ?? 0;
  const p8 = parent[8] ?? 0;
  const p9 = parent[9] ?? 0;
  const p10 = parent[10] ?? 1;
  out[0] = p0 * l0 + p4 * l1 + p8 * l2;
  out[1] = p1 * l0 + p5 * l1 + p9 * l2;
  out[2] = p2 * l0 + p6 * l1 + p10 * l2;
  out[4] = p0 * l4 + p4 * l5 + p8 * l6;
  out[5] = p1 * l4 + p5 * l5 + p9 * l6;
  out[6] = p2 * l4 + p6 * l5 + p10 * l6;
  out[8] = p4 * l9 + p8 * l10;
  out[9] = p5 * l9 + p9 * l10;
  out[10] = p6 * l9 + p10 * l10;
  out[12] = p0 * tx + p4 * ty + p8 * tz + (parent[12] ?? 0);
  out[13] = p1 * tx + p5 * ty + p9 * tz + (parent[13] ?? 0);
  out[14] = p2 * tx + p6 * ty + p10 * tz + (parent[14] ?? 0);
}

/** Copies `m` into `target` at matrix slot `slot` (an InstancedMesh's instanceMatrix array). */
export function writeMat(target: Float32Array, slot: number, m: Mat): void {
  const at = slot * 16;
  for (let i = 0; i < 16; i++) target[at + i] = m[i] ?? 0;
}
