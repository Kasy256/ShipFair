import { expect, test } from '@playwright/test';
import { boot, DT, report } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await boot(page);
});

// Everything below runs inside the page in one evaluate (15 000 physics steps), so the geometry
// helpers are defined there too. Capsule: radius 0.3, axis from feet + 0.31 to feet + 1.51.
test('walls: 100 random runs × 150 steps, 0 tunnels, max penetration < 3 cm', async ({ page }) => {
  const result = await page.evaluate((dt) => {
    const api = window.__shipfair;
    const level = api?.level;
    const input = api?.player.input;
    if (!api || !level || !input) throw new Error('no test api');
    const R = 0.3;
    const AXIS_LO = 0.31;
    const AXIS_HI = 1.51;
    const STEP = 0.45;
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const rectDist = (x: number, z: number, x0: number, x1: number, z0: number, z1: number) =>
      Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
    /** Deepest overlap of the capsule at feet (x, y, z) with any box or pillar, in metres. */
    const penetration = (x: number, y: number, z: number, r = R) => {
      let worst = 0;
      const lo = y + AXIS_LO;
      const hi = y + AXIS_HI;
      for (const b of level.boxes) {
        const dh = rectDist(x, z, b.min[0], b.max[0], b.min[2], b.max[2]);
        const dv = Math.max(0, b.min[1] - hi, lo - b.max[1]);
        let pen = r - Math.hypot(dh, dv);
        if (dh === 0 && dv === 0) {
          pen = r + Math.min(x - b.min[0], b.max[0] - x, z - b.min[2], b.max[2] - z);
        }
        worst = Math.max(worst, pen);
      }
      for (const c of level.cylinders) {
        const dh = Math.max(0, Math.hypot(x - c.center[0], z - c.center[2]) - c.radius);
        const dv = Math.max(0, c.center[1] - c.halfHeight - hi, lo - (c.center[1] + c.halfHeight));
        worst = Math.max(worst, r - Math.hypot(dh, dv));
      }
      return worst;
    };
    /** True when the centre's path crossed into a blocker (shrunk 2 cm so grazing doesn't count). */
    const tunnelled = (x0: number, z0: number, x1: number, z1: number, feet: number) => {
      for (const b of level.boxes) {
        if (b.max[1] <= feet + STEP || b.min[1] >= feet + 1.8) continue;
        const lo = [b.min[0] + 0.02, b.min[2] + 0.02];
        const hi = [b.max[0] - 0.02, b.max[2] - 0.02];
        let t0 = 0;
        let t1 = 1;
        const p = [x0, z0];
        const d = [x1 - x0, z1 - z0];
        let hits = true;
        for (let k = 0; k < 2; k++) {
          const pk = p[k] ?? 0;
          const dk = d[k] ?? 0;
          const lk = lo[k] ?? 0;
          const hk = hi[k] ?? 0;
          if (Math.abs(dk) < 1e-9) {
            if (pk < lk || pk > hk) hits = false;
          } else {
            const a = (lk - pk) / dk;
            const c = (hk - pk) / dk;
            t0 = Math.max(t0, Math.min(a, c));
            t1 = Math.min(t1, Math.max(a, c));
            if (t0 > t1) hits = false;
          }
        }
        if (hits) return true;
      }
      return false;
    };
    const ramp = level.ramps[0];
    const onRamp = (x: number, z: number) =>
      ramp !== undefined &&
      Math.abs(x - ramp.x) < ramp.halfWidth + R + 0.1 &&
      z > ramp.z0 - R - 0.1 &&
      z < ramp.z1 + R + 0.1;
    const freeSpot = (): [number, number] => {
      for (let k = 0; k < 1000; k++) {
        const x = -29 + rnd() * 58;
        const z = -29 + rnd() * 58;
        // Clear of every box and pillar (not just blockers), so every run starts on the floor.
        const isClear =
          !onRamp(x, z) &&
          level.boxes.every(
            (b) =>
              b.kind === 'floor' ||
              rectDist(x, z, b.min[0], b.max[0], b.min[2], b.max[2]) > R + 0.05,
          ) &&
          level.cylinders.every(
            (c) => Math.hypot(x - c.center[0], z - c.center[2]) > c.radius + R + 0.05,
          );
        if (isClear) return [x, z];
      }
      throw new Error('no free spot');
    };

    let tunnels = 0;
    let maxPen = 0;
    let endInside = 0;
    let steps = 0;
    let metres = 0;
    let wallContacts = 0;
    const runs = 100;
    input.isActive = true;
    for (let i = 0; i < runs; i++) {
      const [x, z] = freeSpot();
      api.player.teleport(x, 0, z, 0);
      api.camera.set(rnd() * Math.PI * 2, 0.22, 4.6);
      input.moveY = 1;
      input.moveX = rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0;
      input.run = true;
      let px = x;
      let pz = z;
      for (let s = 0; s < 150; s++) {
        api.step(dt);
        steps++;
        const p = api.player.position;
        if (!onRamp(p.x, p.z)) {
          if (tunnelled(px, pz, p.x, p.z, p.y)) tunnels++;
          const pen = penetration(p.x, p.y, p.z);
          maxPen = Math.max(maxPen, pen);
          // Within 2 cm of something too tall to step onto: the run is sliding along a wall.
          const isAtWall = level.boxes.some(
            (b) =>
              b.max[1] > p.y + STEP &&
              b.min[1] < p.y + 1.8 &&
              rectDist(p.x, p.z, b.min[0], b.max[0], b.min[2], b.max[2]) < R + 0.02,
          );
          if (isAtWall) wallContacts++;
        }
        metres += Math.hypot(p.x - px, p.z - pz);
        px = p.x;
        pz = p.z;
      }
      const p = api.player.position;
      if (!onRamp(p.x, p.z) && penetration(p.x, p.y, p.z) > 0.05) endInside++;
    }
    input.isActive = false;
    input.moveX = 0;
    input.moveY = 0;
    input.run = false;
    return { runs, steps, metres, tunnels, maxPenCm: maxPen * 100, endInside, wallContacts };
  }, DT);
  report('runs', result.runs);
  report('physicsSteps', result.steps);
  report('metresRun', Math.round(result.metres));
  report('stepsAgainstAWall', result.wallContacts);
  report('tunnels', result.tunnels);
  report('maxPenetrationCm', result.maxPenCm.toFixed(3));
  report('endedInsideGeometry', result.endInside);
  expect(result.wallContacts).toBeGreaterThan(100); // the runs really did hit walls
  expect(result.tunnels).toBe(0);
  expect(result.maxPenCm).toBeLessThan(3);
  expect(result.endInside).toBe(0);
});

test('camera: 100 random positions and angles, never inside a collider', async ({ page }) => {
  const result = await page.evaluate((dt) => {
    const api = window.__shipfair;
    const level = api?.level;
    if (!api || !level) throw new Error('no test api');
    let seed = 11;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let inside = 0;
    let framesChecked = 0;
    let pulledIn = 0;
    const fallbacksBefore = api.camera.fallbacks;
    for (let i = 0; i < 100; i++) {
      // Anywhere on the map: the floor, crates, stairs, platforms, hard against walls.
      const x = -29.5 + rnd() * 59;
      const z = -29.5 + rnd() * 59;
      api.player.teleport(x, 3, z, rnd() * Math.PI * 2);
      const distance = 1.6 + rnd() * 8.4;
      api.camera.set(rnd() * Math.PI * 2, -0.35 + rnd() * 1.55, distance);
      for (let f = 0; f < 40; f++) {
        api.step(dt);
        const c = api.camera.position;
        framesChecked++;
        if (api.physics.isInside(c.x, c.y, c.z)) inside++;
      }
      const c = api.camera.position;
      const p = api.player.position;
      if (Math.hypot(c.x - p.x, c.y - p.y - 1.55, c.z - p.z) < distance - 0.3) pulledIn++;
    }
    return {
      positions: 100,
      framesChecked,
      inside,
      pulledIn,
      fallbacks: api.camera.fallbacks - fallbacksBefore,
    };
  }, DT);
  report('positions', result.positions);
  report('framesChecked', result.framesChecked);
  report('framesInsideCollider', result.inside);
  report('positionsPulledInByGeometry', result.pulledIn);
  report('headFallbacks', result.fallbacks);
  expect(result.inside).toBe(0);
  expect(result.pulledIn).toBeGreaterThan(0); // collisions were actually exercised
});
