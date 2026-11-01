// Clicking a player (prompt 12). Every remote player is hit-tested as a vertical cylinder around
// their drawn position, whichever LOD draws them: the nearest are glTF characters, which aren't
// instances, so an instance id from a raycast against the stand-in mesh would miss them. The
// maths is plain numbers, so a pick allocates nothing.

/**
 * Distance along the ray (origin o, unit direction d) to where it first enters the vertical
 * cylinder of `radius` standing on (cx, cy, cz) with `height`, or Infinity if it misses.
 */
export function rayHitsCylinder(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  height: number,
): number {
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  const c = px * px + pz * pz - radius * radius;
  let tEnter: number;
  let tExit: number;
  if (a < 1e-12) {
    // Straight up or down: inside the circle or never.
    if (c > 0) return Number.POSITIVE_INFINITY;
    tEnter = Number.NEGATIVE_INFINITY;
    tExit = Number.POSITIVE_INFINITY;
  } else {
    const b = px * dx + pz * dz;
    const disc = b * b - a * c;
    if (disc < 0) return Number.POSITIVE_INFINITY;
    const root = Math.sqrt(disc);
    tEnter = (-b - root) / a;
    tExit = (-b + root) / a;
  }
  // Clip to the slab between the cylinder's bottom and top.
  if (Math.abs(dy) < 1e-12) {
    if (oy < cy || oy > cy + height) return Number.POSITIVE_INFINITY;
  } else {
    let t0 = (cy - oy) / dy;
    let t1 = (cy + height - oy) / dy;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    tEnter = Math.max(tEnter, t0);
    tExit = Math.min(tExit, t1);
  }
  if (tEnter > tExit || tExit < 0) return Number.POSITIVE_INFINITY;
  return Math.max(tEnter, 0);
}
