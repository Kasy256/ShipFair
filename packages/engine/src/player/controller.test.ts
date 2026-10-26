import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT_S, GRAVITY_MPS2, JUMP_SPEED_MPS } from '../config.ts';
import { createInputState, type InputState } from '../input/state.ts';
import { initPhysics, PhysicsWorld } from '../physics/world.ts';
import { buildTestLevel } from '../world/test-level.ts';
import { testLevelLayout } from '../world/test-level-layout.ts';
import { PlayerController } from './controller.ts';
import { verticalStep } from './motion.ts';

beforeAll(async () => {
  await initPhysics();
});

interface Rig {
  physics: PhysicsWorld;
  input: InputState;
  player: PlayerController;
  camYaw: { value: number };
  step(n?: number): void;
}

function rig(x: number, z: number): Rig {
  const physics = new PhysicsWorld();
  const layout = testLevelLayout();
  buildTestLevel(layout, physics);
  physics.world.step();
  const input = createInputState();
  const camYaw = { value: 0 };
  const player = new PlayerController(physics, input, () => camYaw.value, { x, y: 0, z, yaw: 0 });
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      player.fixedUpdate(FIXED_DT_S);
      physics.fixedUpdate();
    }
  };
  step(10); // settle onto the floor
  return { physics, input, player, camYaw, step };
}

/** Camera yaw that makes "forward" point along +z. */
const FACE_PLUS_Z = Math.PI;

describe('verticalStep', () => {
  it('hits the analytic apex and airtime at 60 Hz', () => {
    let y = 0;
    let v = JUMP_SPEED_MPS;
    let apex = 0;
    let frames = 0;
    do {
      y += verticalStep(v, FIXED_DT_S);
      v -= GRAVITY_MPS2 * FIXED_DT_S;
      apex = Math.max(apex, y);
      frames++;
    } while (y > 0);
    expect(apex).toBeCloseTo(JUMP_SPEED_MPS ** 2 / (2 * GRAVITY_MPS2), 2);
    expect(frames * FIXED_DT_S).toBeCloseTo((2 * JUMP_SPEED_MPS) / GRAVITY_MPS2, 2);
  });
});

describe('PlayerController (Rapier, deterministic steps)', () => {
  it('stands on the floor after spawning', () => {
    const { player } = rig(0, 8);
    expect(player.isGrounded).toBe(true);
    expect(player.position.y).toBeCloseTo(0, 2);
  });

  it('jumps to ≈ 1.2 m and lands after ≈ 0.633 s', () => {
    const { player, input, step } = rig(0, 8);
    const y0 = player.position.y;
    input.jump = true;
    let apex = 0;
    let air = 0;
    for (let i = 0; i < 120; i++) {
      step();
      apex = Math.max(apex, player.position.y - y0);
      if (!player.isGrounded) air += FIXED_DT_S;
      else if (air > 0) break;
    }
    expect(Math.abs(apex - 1.2) / 1.2).toBeLessThan(0.05);
    expect(Math.abs(air - 0.633) / 0.633).toBeLessThan(0.05);
    expect(player.isGrounded).toBe(true);
    expect(player.jumps).toBe(1);
  });

  it('walks up the 0.3 m stairs onto the 1.2 m platform', () => {
    const layout = testLevelLayout();
    const { player, input, camYaw, step } = rig(layout.stairsStart.x, layout.stairsStart.z);
    camYaw.value = FACE_PLUS_Z;
    let maxRise = 0;
    for (let i = 0; i < 300 && player.position.z < 14; i++) {
      input.moveY = 1;
      const before = player.position.y;
      step();
      maxRise = Math.max(maxRise, player.position.y - before);
    }
    input.moveY = 0;
    step(30);
    expect(player.position.z).toBeGreaterThan(12.2);
    expect(player.position.y).toBeGreaterThan(1.18);
    expect(player.position.y).toBeLessThan(1.22);
    expect(maxRise).toBeLessThanOrEqual(0.45 + 1e-6);
  });

  it('climbs the stairs with a gentle stick push (floored to 1.3 m/s)', () => {
    const layout = testLevelLayout();
    const { player, input, camYaw, step } = rig(layout.stairsStart.x, 10);
    camYaw.value = FACE_PLUS_Z;
    for (let i = 0; i < 600 && player.position.z < 12.6; i++) {
      input.moveY = 0.6 / 2.6;
      step();
    }
    expect(player.position.y).toBeCloseTo(1.2, 1);
  });

  it('climbs the ramp', () => {
    const { player, input, camYaw, step } = rig(-12, 7);
    camYaw.value = FACE_PLUS_Z;
    for (let i = 0; i < 300 && player.position.z < 16; i++) {
      input.moveY = 1;
      step();
    }
    input.moveY = 0;
    step(20);
    expect(player.position.y).toBeCloseTo(1.2, 1);
  });

  it('does not pass through a thin wall when running at it', () => {
    // The 0.2 m wall at x = 10..10.2, z = -18..-2. Run toward +x from x = 6.
    const { player, input, camYaw, step } = rig(6, -10);
    camYaw.value = -Math.PI / 2; // forward = +x
    input.run = true;
    for (let i = 0; i < 150; i++) {
      input.moveY = 1;
      step();
    }
    expect(player.position.x).toBeLessThan(10 - 0.3 + 0.03);
  });

  it('stops rising when the head hits a ceiling', () => {
    const { physics, player, input, step } = rig(0, 0);
    physics.addBox({ x: 0, y: 2.6, z: 0 }, { x: 1, y: 0.1, z: 1 });
    physics.world.step();
    input.jump = true;
    let apex = 0;
    for (let i = 0; i < 60; i++) {
      step();
      apex = Math.max(apex, player.position.y);
    }
    // Head (1.8 m tall + skin) stops just under the 2.5 m underside.
    expect(apex).toBeLessThan(0.75);
    expect(player.isGrounded).toBe(true);
  });

  it('300 random wall runs never sink more than 1 cm into a box', () => {
    const level = testLevelLayout();
    const { physics, player, input, camYaw, step } = rig(0, 8);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const rectDist = (x: number, z: number, b: (typeof level.boxes)[number]) =>
      Math.hypot(Math.max(b.min[0] - x, 0, x - b.max[0]), Math.max(b.min[2] - z, 0, z - b.max[2]));
    /** Capsule (axis feet + 0.31 … feet + 1.51, radius 0.3) overlap with the deepest box. */
    const penetration = (x: number, y: number, z: number) => {
      let worst = 0;
      for (const b of level.boxes) {
        const dv = Math.max(0, b.min[1] - (y + 1.51), y + 0.31 - b.max[1]);
        worst = Math.max(worst, 0.3 - Math.hypot(rectDist(x, z, b), dv));
      }
      return worst;
    };
    const ramp = level.ramps[0];
    const isNearRamp = (x: number, z: number) =>
      ramp !== undefined &&
      Math.abs(x - ramp.x) < ramp.halfWidth + 0.4 &&
      z > ramp.z0 - 0.4 &&
      z < ramp.z1 + 0.4;
    const pillar = level.cylinders[0];
    const isFree = (x: number, z: number) =>
      !isNearRamp(x, z) &&
      level.boxes.every((b) => b.kind === 'floor' || rectDist(x, z, b) > 0.35) &&
      (pillar === undefined ||
        Math.hypot(x - pillar.center[0], z - pillar.center[2]) > pillar.radius + 0.35);

    let worst = 0;
    for (let run = 0; run < 300; run++) {
      let x = 0;
      let z = 0;
      do {
        x = -29 + rnd() * 58;
        z = -29 + rnd() * 58;
      } while (!isFree(x, z));
      player.teleport(x, 0, z, 0);
      camYaw.value = rnd() * Math.PI * 2;
      const strafe = rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0;
      for (let s = 0; s < 150; s++) {
        input.moveY = 1;
        input.moveX = strafe;
        input.run = true;
        step();
        const p = player.position;
        if (!isNearRamp(p.x, p.z)) worst = Math.max(worst, penetration(p.x, p.y, p.z));
      }
    }
    physics.dispose();
    expect(worst).toBeLessThan(0.01);
  }, 30_000); // 45 000 physics steps: ~4 s alone, slower under turbo's parallel runs
});
