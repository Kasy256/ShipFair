import { PerspectiveCamera, Vector3 } from 'three';
import {
  CAMERA_EASE_OUT_HZ,
  CAMERA_FAR_M,
  CAMERA_FOV_DEG,
  CAMERA_MIN_CLEARANCE_M,
  CAMERA_MIN_DIST_M,
  CAMERA_NEAR_M,
  CAMERA_PITCH_DEFAULT_RAD,
  CAMERA_PITCH_MAX_RAD,
  CAMERA_PITCH_MIN_RAD,
  CAMERA_SHOULDER_M,
  CAMERA_SIDE_MARGIN_M,
  CAMERA_TARGET_FOLLOW_HZ,
  CAMERA_TARGET_HEIGHT_M,
  CAMERA_TARGET_SNAP_M,
  CAMERA_WALL_MARGIN_M,
  CAMERA_ZOOM_DEFAULT_M,
  CAMERA_ZOOM_MAX_M,
  CAMERA_ZOOM_MIN_M,
} from '../config.ts';
import type { InputState } from '../input/state.ts';
import type { PhysicsWorld } from '../physics/world.ts';

// Scratch vectors: the camera runs every frame and must not allocate.
const head = new Vector3();
const dir = new Vector3();
const right = new Vector3();
const toTarget = new Vector3();

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Third-person orbit camera with a right-shoulder offset (the prototype's `updateCamera`, with
 * Rapier rays). Walls pull it in at once; it eases back out slowly. The camera is never placed
 * past the first surface between the player's head and where it wants to be.
 */
export class FollowCamera {
  readonly camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR_M, CAMERA_FAR_M);
  /** Orbit angle; the camera sits at (sin yaw, cos yaw) from the target, looking back at it. */
  yaw = 0;
  pitch = CAMERA_PITCH_DEFAULT_RAD;
  /** Zoom the player asked for. */
  distance = CAMERA_ZOOM_DEFAULT_M;
  /** Distance after collision and easing. */
  currentDistance = CAMERA_ZOOM_DEFAULT_M;
  readonly target = new Vector3();
  /** The point the camera looks at (target plus shoulder offset). */
  readonly origin = new Vector3();
  /** Frames where the ray result still landed inside geometry and the head was used instead. */
  fallbacks = 0;
  readonly #physics: PhysicsWorld;
  readonly #input: InputState;
  #hasTarget = false;

  constructor(physics: PhysicsWorld, input: InputState) {
    this.#physics = physics;
    this.#input = input;
  }

  /** Jump straight to the player next frame (teleports, spawn). */
  snap(): void {
    this.#hasTarget = false;
  }

  /** `feet` is the interpolated player position for this frame. */
  update(dt: number, feet: Vector3): void {
    const input = this.#input;
    this.yaw += input.lookYaw;
    this.pitch = clamp(this.pitch + input.lookPitch, CAMERA_PITCH_MIN_RAD, CAMERA_PITCH_MAX_RAD);
    this.distance = clamp(this.distance + input.zoom, CAMERA_ZOOM_MIN_M, CAMERA_ZOOM_MAX_M);
    input.lookYaw = 0;
    input.lookPitch = 0;
    input.zoom = 0;

    const physics = this.#physics;
    head.set(feet.x, feet.y + CAMERA_TARGET_HEIGHT_M, feet.z);
    if (!this.#hasTarget || this.target.distanceTo(head) > CAMERA_TARGET_SNAP_M) {
      this.target.copy(head);
      this.currentDistance = this.distance;
      this.#hasTarget = true;
    } else {
      this.target.lerp(head, 1 - Math.exp(-dt * CAMERA_TARGET_FOLLOW_HZ));
      // The lagging target must not cut through a corner the head went around.
      toTarget.subVectors(this.target, head);
      const lag = toTarget.length();
      if (lag > 1e-4 && physics.castRay(head, toTarget.divideScalar(lag), lag) < lag) {
        this.target.copy(head);
      }
    }

    const cosPitch = Math.cos(this.pitch);
    dir.set(Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), Math.cos(this.yaw) * cosPitch);
    right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const sideRoom = physics.castRay(this.target, right, CAMERA_SHOULDER_M + CAMERA_SIDE_MARGIN_M);
    const side = clamp(sideRoom - CAMERA_SIDE_MARGIN_M, 0, CAMERA_SHOULDER_M);
    this.origin.copy(this.target).addScaledVector(right, side);

    const hit = physics.castRay(this.origin, dir, this.distance);
    // Keep a margin off a blocking surface, prefer not to sit closer than the minimum
    // distance, but never go past the surface itself.
    const want =
      hit < this.distance
        ? Math.max(
            0,
            Math.min(
              Math.max(CAMERA_MIN_DIST_M, hit - CAMERA_WALL_MARGIN_M),
              hit - CAMERA_MIN_CLEARANCE_M,
            ),
          )
        : this.distance;
    this.currentDistance =
      want < this.currentDistance
        ? want
        : this.currentDistance +
          (want - this.currentDistance) * Math.min(1, dt * CAMERA_EASE_OUT_HZ);

    const camera = this.camera;
    camera.position.copy(this.origin).addScaledVector(dir, this.currentDistance);
    // Belt and braces: should the point still be inside something, fall back to the head.
    if (physics.isInsideStatic(camera.position)) {
      camera.position.copy(head);
      this.fallbacks++;
    }
    camera.lookAt(this.origin);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
