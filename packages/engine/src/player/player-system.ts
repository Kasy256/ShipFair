import type { AvatarStyleV2 } from '@shipfair/shared';
import { Vector3 } from 'three';
import { STEP_UP_SMOOTH_HZ } from '../config.ts';
import type { Loop, System } from '../core/loop.ts';
import type { InputState } from '../input/state.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import { type AvatarView, EMOTE_WAVE, ProceduralAvatar } from './avatar.ts';
import { FollowCamera } from './camera.ts';
import { PlayerController, type Spawn } from './controller.ts';

/** A grounded height jump bigger than this in one frame is a step pop (ramps change less). */
const STEP_POP_M = 0.06;
/** Larger grounded height changes (teleports, falls) are shown at once, not eased. */
const MAX_SMOOTH_STEP_M = 0.6;

/**
 * The local player: movement at fixed rate, then once per frame the interpolated avatar pose,
 * animation and camera. Steps up and down are eased so autostep doesn't pop the avatar or the
 * camera (the prototype's `visualY`).
 */
export class PlayerSystem implements System {
  readonly controller: PlayerController;
  readonly camera: FollowCamera;
  #avatar: AvatarView;
  /** The interpolated, step-smoothed feet position rendered this frame. */
  readonly renderPosition = new Vector3();
  readonly #input: InputState;
  readonly #loop: Loop;
  #lastY = Number.NaN;
  #offsetY = 0;
  /** Footsteps so far; audio hooks in later (prompt 16). */
  footsteps = 0;
  interactions = 0;
  /** Called on the interact action (E, touch button, gamepad X, click while pointer-locked). */
  onInteract: (() => void) | undefined;

  constructor(
    physics: PhysicsWorld,
    input: InputState,
    loop: Loop,
    spawn: Spawn,
    style: AvatarStyleV2,
  ) {
    this.#input = input;
    this.#loop = loop;
    this.camera = new FollowCamera(physics, input);
    this.camera.yaw = spawn.yaw + Math.PI;
    this.controller = new PlayerController(physics, input, () => this.camera.yaw, spawn);
    this.#avatar = new ProceduralAvatar(style);
  }

  get avatar(): AvatarView {
    return this.#avatar;
  }

  /**
   * Swaps the avatar (the procedural rig for a glTF character once art has loaded). The new one
   * takes the old one's place in the scene; the old one is disposed.
   */
  setAvatar(next: AvatarView): void {
    const old = this.#avatar;
    old.object.parent?.add(next.object);
    next.object.position.copy(old.object.position);
    next.object.rotation.y = old.object.rotation.y;
    this.#avatar = next;
    old.dispose();
  }

  teleport(x: number, y: number, z: number, yaw?: number): void {
    this.controller.teleport(x, y, z, yaw);
    if (yaw !== undefined) this.camera.yaw = yaw + Math.PI;
    this.#lastY = Number.NaN;
    this.#offsetY = 0;
    this.camera.snap();
  }

  fixedUpdate(dt: number): void {
    this.controller.fixedUpdate(dt);
    const input = this.#input;
    if (input.wave) this.avatar.playEmote(EMOTE_WAVE);
    if (input.interact) {
      this.interactions++;
      this.onInteract?.();
    }
    input.wave = false;
    input.interact = false;
  }

  update(dt: number, alpha: number): void {
    const c = this.controller;
    const pos = this.renderPosition;
    const yaw = c.interpolate(alpha, pos);
    const jump = pos.y - this.#lastY;
    this.#lastY = pos.y;
    if (c.isGrounded && Math.abs(jump) > STEP_POP_M && Math.abs(jump) < MAX_SMOOTH_STEP_M) {
      this.#offsetY -= jump;
    }
    this.#offsetY *= Math.exp(-dt * STEP_UP_SMOOTH_HZ);
    pos.y += this.#offsetY;

    const object = this.avatar.object;
    object.position.copy(pos);
    object.rotation.y = yaw;
    this.avatar.setLocomotion(c.speed, c.isGrounded, c.velocity.y);
    if (this.avatar.update(dt, this.#loop.time)) this.footsteps++;
    this.camera.update(dt, pos);
  }

  setStyle(style: AvatarStyleV2): void {
    this.avatar.setStyle(style);
  }

  dispose(): void {
    this.#avatar.dispose();
    this.controller.dispose();
  }
}
