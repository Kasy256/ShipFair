// Minimap math (the prototype's drawMinimap, as a pure transform). World (x, z) maps to canvas
// pixels so the camera's look direction points up and the player sits at the centre.

export interface MinimapView {
  x: number;
  z: number;
  /** Camera look yaw: the look direction is (sin yaw, cos yaw). */
  cameraYaw: number;
}

/**
 * Fills `out` with the canvas transform [a, b, c, d, e, f] (as `setTransform` takes it) for
 * `scale` px per metre around `(cx, cy)`. Screen right is the camera's right, screen up its look.
 */
export function minimapMatrix(
  view: Readonly<MinimapView>,
  scale: number,
  cx: number,
  cy: number,
  out: Float64Array,
): Float64Array {
  const s = Math.sin(view.cameraYaw);
  const c = Math.cos(view.cameraYaw);
  // Look L = (s, c); right R = (-c, s) (y up, yaw turns +z toward +x). screen = (d·R, -(d·L)).
  const a = -c * scale;
  const cc = s * scale;
  const b = -s * scale;
  const d = -c * scale;
  out[0] = a;
  out[1] = b;
  out[2] = cc;
  out[3] = d;
  out[4] = cx - (a * view.x + cc * view.z);
  out[5] = cy - (b * view.x + d * view.z);
  return out;
}

/** Rotation (radians, clockwise from up) of the player arrow, given the avatar's yaw. */
export function arrowAngle(playerYaw: number, cameraYaw: number): number {
  // A heading rotates clockwise on screen as yaw grows past the camera's.
  return cameraYaw - playerYaw;
}
