import { RUN_SPEED_MPS, WALK_SPEED_MPS } from '@shipfair/shared';
import { Vector3 } from 'three';
import {
  CAPSULE_HALF_HEIGHT_M,
  CAPSULE_RADIUS_M,
  GRAVITY_MPS2,
  JUMP_SPEED_MPS,
  KCC_NORMAL_NUDGE,
  KCC_OFFSET_M,
  KILL_Y_M,
  LAND_MIN_AIRTIME_S,
  MAX_SLOPE_RAD,
  MIN_ANALOG_SPEED_RATIO,
  MOVE_EPSILON_MPS,
  SNAP_TO_GROUND_M,
  STEP_HEIGHT_M,
  STEP_MIN_WIDTH_M,
} from '../config.ts';
import type { System } from '../core/loop.ts';
import type { InputState } from '../input/state.ts';
import {
  GROUP_PLAYER,
  GROUP_STATIC,
  type PhysicsWorld,
  RAPIER,
  STATIC_ONLY,
} from '../physics/world.ts';
import { approach, lerpAngle, turnToward, verticalStep } from './motion.ts';

/** Height of the capsule centre above the feet (the skin offset keeps it off the floor). */
const CENTER_ABOVE_FEET_M = CAPSULE_HALF_HEIGHT_M + CAPSULE_RADIUS_M + KCC_OFFSET_M;
const HEAD_BUMP_EPSILON_M = 1e-4;

export interface Spawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * The local player's movement: camera-relative input, prototype acceleration and turn rates,
 * fed into Rapier's KinematicCharacterController for collision, steps, slopes and ground snap.
 * Runs in fixed steps; `interpolate` gives the render pose between the last two.
 */
export class PlayerController implements System {
  /** Feet position after the latest fixed step. */
  readonly position = new Vector3();
  readonly previous = new Vector3();
  readonly velocity = new Vector3();
  yaw = 0;
  previousYaw = 0;
  isGrounded = false;
  airTime = 0;
  /** Set on the step the player touches down after a real fall; cleared by the next step. */
  hasLanded = false;
  jumps = 0;
  readonly spawn: Spawn;
  readonly #physics: PhysicsWorld;
  readonly #input: InputState;
  readonly #cameraYaw: () => number;
  readonly #collider: RAPIER.Collider;
  readonly #kcc: RAPIER.KinematicCharacterController;
  readonly #desired = { x: 0, y: 0, z: 0 };
  readonly #moved = new RAPIER.Vector3(0, 0, 0);
  readonly #center = { x: 0, y: 0, z: 0 };

  constructor(physics: PhysicsWorld, input: InputState, cameraYaw: () => number, spawn: Spawn) {
    this.#physics = physics;
    this.#input = input;
    this.#cameraYaw = cameraYaw;
    this.spawn = spawn;
    const desc = RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT_M, CAPSULE_RADIUS_M)
      .setCollisionGroups(((GROUP_PLAYER << 16) | GROUP_STATIC) >>> 0)
      .setTranslation(spawn.x, spawn.y + CENTER_ABOVE_FEET_M, spawn.z);
    this.#collider = physics.world.createCollider(desc);
    const kcc = physics.world.createCharacterController(KCC_OFFSET_M);
    kcc.enableAutostep(STEP_HEIGHT_M, STEP_MIN_WIDTH_M, false);
    kcc.setMaxSlopeClimbAngle(MAX_SLOPE_RAD);
    kcc.setMinSlopeSlideAngle(MAX_SLOPE_RAD);
    kcc.enableSnapToGround(SNAP_TO_GROUND_M);
    kcc.setApplyImpulsesToDynamicBodies(false);
    kcc.setNormalNudgeFactor(KCC_NORMAL_NUDGE);
    this.#kcc = kcc;
    this.teleport(spawn.x, spawn.y, spawn.z, spawn.yaw);
  }

  /** Horizontal speed actually achieved in the last step (m/s), what the animation reads. */
  speed = 0;

  teleport(x: number, y: number, z: number, yaw = this.yaw): void {
    this.position.set(x, y, z);
    this.previous.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.previousYaw = yaw;
    this.isGrounded = false;
    this.airTime = 0;
    this.hasLanded = false;
    this.#collider.setTranslation({ x, y: y + CENTER_ABOVE_FEET_M, z });
  }

  fixedUpdate(dt: number): void {
    const input = this.#input;
    const vel = this.velocity;
    this.previous.copy(this.position);
    this.previousYaw = this.yaw;
    this.hasLanded = false;

    // Camera-relative wish direction. Forward is away from the camera.
    const camYaw = this.#cameraYaw();
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    const wishX = -sin * input.moveY + cos * input.moveX;
    const wishZ = -cos * input.moveY - sin * input.moveX;
    const wishLen = Math.hypot(wishX, wishZ);
    const push = wishLen > 0 ? Math.max(MIN_ANALOG_SPEED_RATIO, Math.min(1, wishLen)) : 0;
    const speed = (input.run ? RUN_SPEED_MPS : WALK_SPEED_MPS) * push;
    const dirX = wishLen > 0 ? wishX / wishLen : 0;
    const dirZ = wishLen > 0 ? wishZ / wishLen : 0;
    vel.x = approach(vel.x, dirX * speed, this.isGrounded, dt);
    vel.z = approach(vel.z, dirZ * speed, this.isGrounded, dt);
    if (wishLen * speed > MOVE_EPSILON_MPS)
      this.yaw = turnToward(this.yaw, Math.atan2(dirX, dirZ), dt);

    if (this.isGrounded) vel.y = 0;
    if (input.jump && this.isGrounded) {
      vel.y = JUMP_SPEED_MPS;
      this.isGrounded = false;
      this.jumps++;
    }
    input.jump = false;

    const desired = this.#desired;
    desired.x = vel.x * dt;
    desired.y = verticalStep(vel.y, dt);
    desired.z = vel.z * dt;
    vel.y -= GRAVITY_MPS2 * dt;

    const wasGrounded = this.isGrounded;
    this.#kcc.computeColliderMovement(this.#collider, desired, undefined, STATIC_ONLY);
    const moved = this.#kcc.computedMovement(this.#moved);
    // Rising into a ceiling stops the rise.
    if (vel.y > 0 && moved.y < desired.y - HEAD_BUMP_EPSILON_M) vel.y = 0;
    this.isGrounded = this.#kcc.computedGrounded() && vel.y <= 0;
    if (this.isGrounded) {
      if (!wasGrounded && this.airTime >= LAND_MIN_AIRTIME_S) this.hasLanded = true;
      vel.y = 0;
      this.airTime = 0;
    } else {
      this.airTime += dt;
    }
    this.speed = Math.hypot(moved.x, moved.z) / dt;

    this.position.x += moved.x;
    this.position.y += moved.y;
    this.position.z += moved.z;
    const center = this.#center;
    center.x = this.position.x;
    center.y = this.position.y + CENTER_ABOVE_FEET_M;
    center.z = this.position.z;
    this.#collider.setTranslation(center);

    if (this.position.y < KILL_Y_M || !Number.isFinite(this.position.lengthSq())) {
      const s = this.spawn;
      this.teleport(s.x, s.y, s.z, s.yaw);
    }
  }

  /** Render pose between the last two fixed steps. */
  interpolate(alpha: number, out: Vector3): number {
    out.lerpVectors(this.previous, this.position, alpha);
    return lerpAngle(this.previousYaw, this.yaw, alpha);
  }

  dispose(): void {
    // The world may already be freed when the engine tears down in reverse order.
    if (this.#physics.isAlive) {
      this.#physics.world.removeCharacterController(this.#kcc);
      this.#physics.world.removeCollider(this.#collider, false);
    }
  }
}
