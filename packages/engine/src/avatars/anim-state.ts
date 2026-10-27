import { RUN_SPEED_MPS, WALK_SPEED_MPS } from '@shipfair/shared';
import {
  ANIM_CROSSFADE_S,
  ANIM_IDLE_MPS,
  ANIM_JUMP_START_S,
  ANIM_LAND_S,
  MOVE_EPSILON_MPS,
} from '../config.ts';

/** Clip slots the state machine weights. EMOTE plays whichever emote clip is current. */
export const SLOT = {
  idle: 0,
  walk: 1,
  run: 2,
  jump_start: 3,
  jump_air: 4,
  jump_land: 5,
  sit_idle: 6,
  emote: 7,
} as const;
export const SLOT_COUNT = 8;
export const SLOT_NAMES = [
  'idle',
  'walk',
  'run',
  'jump_start',
  'jump_air',
  'jump_land',
  'sit_idle',
  'emote',
] as const;

/** Emote ids carried by the `emote` bus event and network message, in order. */
export const EMOTE_CLIPS = [
  'emote_wave',
  'emote_clap',
  'emote_dance',
  'emote_cheer',
  'emote_point',
  'emote_sit',
] as const;
/** Loops until the player moves instead of playing once. */
export const LOOPING_EMOTES: ReadonlySet<string> = new Set(['emote_dance']);

export type AnimMode = 'locomotion' | 'jump_start' | 'jump_air' | 'jump_land' | 'sit' | 'emote';

export interface AnimInput {
  speed: number;
  isGrounded: boolean;
  vy: number;
  isSitting: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Pure animation logic: which clips should be playing and how much. idle ↔ walk ↔ run blend by
 * speed; jumps go start → air → land; sitting loops; emotes play once and return, except looping
 * ones (dance), which run until the player moves. `weights` eases toward `target` over
 * ANIM_CROSSFADE_S, so every switch is a 0.2 s crossfade. Allocates nothing per update.
 */
export class AnimState {
  readonly target = new Float32Array(SLOT_COUNT);
  readonly weights = new Float32Array(SLOT_COUNT);
  mode: AnimMode = 'locomotion';
  modeTime = 0;
  emote: string | null = null;
  #emoteDuration = 0;

  constructor() {
    this.weights[SLOT.idle] = 1;
    this.target[SLOT.idle] = 1;
  }

  /** Starts an emote clip of `durationS` seconds (ignored mid-air). */
  playEmote(name: string, durationS: number): void {
    if (this.mode === 'jump_start' || this.mode === 'jump_air') return;
    this.emote = name;
    this.#emoteDuration = durationS;
    this.#enter('emote');
  }

  update(dt: number, input: AnimInput): void {
    this.modeTime += dt;
    this.#advance(input);
    this.#writeTarget(input.speed);
    const step = dt / ANIM_CROSSFADE_S;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const w = this.weights[i] ?? 0;
      const t = this.target[i] ?? 0;
      this.weights[i] = w < t ? Math.min(t, w + step) : Math.max(t, w - step);
    }
  }

  /** The slot with the most weight right now. */
  dominant(): number {
    let best = 0;
    for (let i = 1; i < SLOT_COUNT; i++)
      if ((this.weights[i] ?? 0) > (this.weights[best] ?? 0)) best = i;
    return best;
  }

  #enter(mode: AnimMode): void {
    this.mode = mode;
    this.modeTime = 0;
  }

  #advance(input: AnimInput): void {
    const isMoving = input.speed > MOVE_EPSILON_MPS;
    if (!input.isGrounded) {
      if (this.mode !== 'jump_start' && this.mode !== 'jump_air') {
        this.#enter(input.vy > 0 ? 'jump_start' : 'jump_air');
      } else if (this.mode === 'jump_start' && this.modeTime >= ANIM_JUMP_START_S) {
        this.#enter('jump_air');
      }
      return;
    }
    switch (this.mode) {
      case 'jump_start':
      case 'jump_air':
        this.#enter('jump_land');
        return;
      case 'jump_land':
        if (this.modeTime >= ANIM_LAND_S) this.#enter('locomotion');
        return;
      case 'emote': {
        const isLooping = this.emote !== null && LOOPING_EMOTES.has(this.emote);
        if (isMoving || (!isLooping && this.modeTime >= this.#emoteDuration)) {
          this.emote = null;
          this.#enter('locomotion');
        }
        return;
      }
      default:
        if (input.isSitting && !isMoving) {
          if (this.mode !== 'sit') this.#enter('sit');
        } else if (this.mode === 'sit') this.#enter('locomotion');
    }
  }

  #writeTarget(speed: number): void {
    this.target.fill(0);
    switch (this.mode) {
      case 'locomotion': {
        const walk = clamp01((speed - ANIM_IDLE_MPS) / (WALK_SPEED_MPS - ANIM_IDLE_MPS));
        const run = clamp01((speed - WALK_SPEED_MPS) / (RUN_SPEED_MPS - WALK_SPEED_MPS));
        this.target[SLOT.idle] = 1 - walk;
        this.target[SLOT.walk] = walk * (1 - run);
        this.target[SLOT.run] = walk * run;
        return;
      }
      case 'sit':
        this.target[SLOT.sit_idle] = 1;
        return;
      case 'emote':
        this.target[SLOT.emote] = 1;
        return;
      default:
        this.target[SLOT[this.mode]] = 1;
    }
  }
}
