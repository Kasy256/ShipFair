import { AIR_ACCEL_HZ, GRAVITY_MPS2, GROUND_ACCEL_HZ, TURN_RATE_HZ } from '../config.ts';

/**
 * Exact vertical displacement over one step under constant gravity: Δy = v·dt − ½·g·dt².
 * Semi-implicit Euler at 60 Hz undershoots the jump apex by 5.3 % (KICKOFF_NOTES risk 6).
 */
export function verticalStep(vy: number, dt: number, gravity = GRAVITY_MPS2): number {
  return vy * dt - 0.5 * gravity * dt * dt;
}

/** Eases one horizontal velocity component toward its target, like the prototype. */
export function approach(current: number, target: number, isGrounded: boolean, dt: number): number {
  const rate = isGrounded ? GROUND_ACCEL_HZ : AIR_ACCEL_HZ;
  return current + (target - current) * Math.min(1, rate * dt);
}

/** Wraps an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Turns `yaw` toward `targetYaw` along the short way round, at TURN_RATE_HZ. */
export function turnToward(yaw: number, targetYaw: number, dt: number): number {
  return yaw + wrapAngle(targetYaw - yaw) * Math.min(1, TURN_RATE_HZ * dt);
}

/** Interpolates between two angles along the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}
