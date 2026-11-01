import { type AvatarStyleV2, NET_ANIM, RUN_SPEED_MPS, WALK_SPEED_MPS } from '@shipfair/shared';
import { Vector3 } from 'three';
import { ANIM_IDLE_MPS, CORRECTION_BLEND_S, STEP_UP_SMOOTH_HZ } from '../config.ts';
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
/** Above this speed the network anim id says `run` (halfway between walk and run speed). */
const NET_RUN_MPS = (WALK_SPEED_MPS + RUN_SPEED_MPS) / 2;

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
  /** What is left of a server correction, blended out over CORRECTION_BLEND_S. */
  readonly #correction = new Vector3();
  #correctionS = 0;
  /** Footsteps so far; audio hooks in later (prompt 16). */
  footsteps = 0;
  interactions = 0;
  /** Called on the interact action (E, touch button, gamepad X, click while pointer-locked). */
  onInteract: (() => void) | undefined;
  /** Called whenever the local avatar starts an emote (keys, F, the touch menu); sends it. */
  onEmote: ((emote: number) => void) | undefined;

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

  /** What the body is doing, as the network's `a` field (NET_ANIM). */
  get netAnim(): number {
    const c = this.controller;
    if (!c.isGrounded) return NET_ANIM.air;
    if (c.speed > NET_RUN_MPS) return NET_ANIM.run;
    return c.speed > ANIM_IDLE_MPS ? NET_ANIM.walk : NET_ANIM.idle;
  }

  /** Plays an emote on the local avatar at once and reports it (to be sent). */
  emote(emote: number): void {
    this.avatar.playEmote(emote);
    this.onEmote?.(emote);
  }

  /**
   * The server refused a move (`notice:correct`): physics jumps to its position, and what is drawn
   * blends there over CORRECTION_BLEND_S. The camera follows the drawn position, so it glides too.
   */
  correct(x: number, y: number, z: number): void {
    this.#correction.copy(this.renderPosition).sub({ x, y, z });
    this.#correctionS = CORRECTION_BLEND_S;
    this.controller.teleport(x, y, z);
    this.#lastY = Number.NaN;
    this.#offsetY = 0;
  }

  teleport(x: number, y: number, z: number, yaw?: number): void {
    this.controller.teleport(x, y, z, yaw);
    if (yaw !== undefined) this.camera.yaw = yaw + Math.PI;
    this.#lastY = Number.NaN;
    this.#offsetY = 0;
    this.#correctionS = 0;
    this.camera.snap();
  }

  fixedUpdate(dt: number): void {
    this.controller.fixedUpdate(dt);
    const input = this.#input;
    if (input.wave) this.emote(EMOTE_WAVE);
    if (input.emote >= 0) this.emote(input.emote);
    if (input.interact) {
      this.interactions++;
      this.onInteract?.();
    }
    input.wave = false;
    input.emote = -1;
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
    if (this.#correctionS > 0) {
      pos.addScaledVector(this.#correction, this.#correctionS / CORRECTION_BLEND_S);
      this.#correctionS = Math.max(0, this.#correctionS - dt);
    }

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
