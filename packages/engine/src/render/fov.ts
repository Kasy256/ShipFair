import { CAMERA_MAX_VFOV_DEG, CAMERA_MIN_HFOV_DEG } from '../config.ts';

const DEG = Math.PI / 180;

/**
 * The vertical FOV to use for a viewport. Landscape keeps the chosen one. A portrait phone with
 * the same vertical FOV would see a slit (62° vertical is about 31° across at 9:19.5), so the
 * vertical FOV widens until the horizontal one reaches CAMERA_MIN_HFOV_DEG, capped at
 * CAMERA_MAX_VFOV_DEG. Never narrower than the chosen FOV.
 */
export function fovForAspect(verticalDeg: number, aspect: number): number {
  if (!(aspect > 0) || aspect >= 1) return verticalDeg;
  const needed = (2 * Math.atan(Math.tan((CAMERA_MIN_HFOV_DEG * DEG) / 2) / aspect)) / DEG;
  return Math.max(verticalDeg, Math.min(needed, CAMERA_MAX_VFOV_DEG));
}

/** The horizontal FOV a vertical one gives at `aspect` (width / height). */
export function horizontalFov(verticalDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((verticalDeg * DEG) / 2) * aspect)) / DEG;
}
