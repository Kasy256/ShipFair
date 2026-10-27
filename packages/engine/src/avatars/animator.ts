import { RUN_SPEED_MPS, WALK_SPEED_MPS } from '@shipfair/shared';
import { type AnimationAction, AnimationMixer, LoopOnce, LoopRepeat, type Object3D } from 'three';
import {
  type AnimInput,
  AnimState,
  EMOTE_CLIPS,
  LOOPING_EMOTES,
  SLOT,
  SLOT_COUNT,
  SLOT_NAMES,
} from './anim-state.ts';
import type { AnimationSet } from './animation-set.ts';

/** Walk and run play faster or slower with speed, within these bounds. */
const MIN_TIME_SCALE = 0.6;
const MAX_TIME_SCALE = 1.4;

/**
 * Drives one character's AnimationMixer from AnimState weights. Every action is created once
 * up front; per frame only weights, time scales and the mixer change (no allocation).
 */
export class Animator {
  readonly state = new AnimState();
  readonly #mixer: AnimationMixer;
  readonly #root: Object3D;
  readonly #slots: (AnimationAction | undefined)[] = [];
  readonly #emotes = new Map<string, AnimationAction>();
  #emote: AnimationAction | undefined;
  #preview: AnimationAction | undefined;
  #pending = 0;
  #frame = 0;
  readonly #set: AnimationSet;
  readonly #bodyId: string;

  constructor(root: Object3D, set: AnimationSet, bodyId: string) {
    this.#root = root;
    this.#set = set;
    this.#bodyId = bodyId;
    this.#mixer = new AnimationMixer(root);
    for (let i = 0; i < SLOT_COUNT; i++) {
      const name = SLOT_NAMES[i] ?? '';
      const clip = i === SLOT.emote ? undefined : set.clip(name, bodyId);
      const action = clip ? this.#mixer.clipAction(clip) : undefined;
      if (action) {
        const isOnce = i === SLOT.jump_start || i === SLOT.jump_land;
        action.setLoop(isOnce ? LoopOnce : LoopRepeat, Number.POSITIVE_INFINITY);
        action.clampWhenFinished = isOnce;
        action.setEffectiveWeight(i === SLOT.idle ? 1 : 0).play();
      }
      this.#slots.push(action);
    }
    for (const name of EMOTE_CLIPS) {
      const clip = set.clip(name, bodyId);
      if (!clip) continue;
      const action = this.#mixer.clipAction(clip);
      action.setLoop(LOOPING_EMOTES.has(name) ? LoopRepeat : LoopOnce, Number.POSITIVE_INFINITY);
      action.clampWhenFinished = true;
      action.setEffectiveWeight(0);
      this.#emotes.set(name, action);
    }
  }

  /**
   * Loops any clip by name at full weight, overriding the state machine (the /dev/assets page
   * uses it to inspect clips). Null hands control back to the state machine.
   */
  preview(name: string | null): void {
    const previous = this.#preview;
    previous?.stop();
    // clipAction() caches per clip, so a previewed slot clip is the slot's own action: restart it.
    if (previous && this.#slots.includes(previous)) previous.play();
    this.#preview = undefined;
    const clip = name === null ? undefined : this.#set.clip(name, this.#bodyId);
    if (!clip) return;
    const action = this.#mixer.clipAction(clip);
    action.reset().setLoop(LoopRepeat, Number.POSITIVE_INFINITY).setEffectiveWeight(1).play();
    this.#preview = action;
  }

  /** Name of the clip with the most weight (`emote_*` for the playing emote). */
  get activeClip(): string {
    if (this.#preview) return this.#preview.getClip().name;
    const slot = this.state.dominant();
    return slot === SLOT.emote ? (this.state.emote ?? 'emote') : (SLOT_NAMES[slot] ?? 'idle');
  }

  playEmote(name: string): void {
    const action = this.#emotes.get(name);
    if (!action) return;
    this.#emote?.stop();
    this.#emote = action;
    action.reset().setEffectiveWeight(0).play();
    this.state.playEmote(name, action.getClip().duration);
  }

  /**
   * Advances logic every call; the mixer runs every `every`th call with the summed time (animation
   * LOD: 1 for LOD0, 2 for LOD1). Returns true on a footstep.
   */
  update(dt: number, input: AnimInput, every = 1): boolean {
    const wasMode = this.state.mode;
    this.state.update(dt, input);
    const weights = this.state.weights;
    if (this.state.mode !== wasMode) this.#restartOneShots();
    const walk = this.#slots[SLOT.walk];
    const run = this.#slots[SLOT.run];
    const before = this.#stridePhase();
    walk?.setEffectiveTimeScale(clampScale(input.speed / WALK_SPEED_MPS));
    run?.setEffectiveTimeScale(clampScale(input.speed / RUN_SPEED_MPS));
    const preview = this.#preview;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const action = i === SLOT.emote ? this.#emote : this.#slots[i];
      if (action !== preview) action?.setEffectiveWeight(preview ? 0 : (weights[i] ?? 0));
    }
    this.#pending += dt;
    this.#frame++;
    if (this.#frame % every === 0) {
      this.#mixer.update(this.#pending);
      this.#pending = 0;
    }
    const after = this.#stridePhase();
    return before >= 0 && after >= 0 && Math.floor(before * 2) !== Math.floor(after * 2);
  }

  dispose(): void {
    this.#mixer.stopAllAction();
    this.#mixer.uncacheRoot(this.#root);
  }

  /** 0..1 through the dominant gait's cycle, or -1 when not walking or running. */
  #stridePhase(): number {
    const w = this.state.weights;
    if (this.state.mode !== 'locomotion') return -1;
    const isRun = (w[SLOT.run] ?? 0) > (w[SLOT.walk] ?? 0);
    if (Math.max(w[SLOT.run] ?? 0, w[SLOT.walk] ?? 0) < 0.5) return -1;
    const action = this.#slots[isRun ? SLOT.run : SLOT.walk];
    if (!action) return -1;
    return (action.time / action.getClip().duration) % 1;
  }

  #restartOneShots(): void {
    const mode = this.state.mode;
    if (mode === 'jump_start') this.#slots[SLOT.jump_start]?.reset().play();
    if (mode === 'jump_land') this.#slots[SLOT.jump_land]?.reset().play();
    // A finished emote fades out through its slot weight; at weight 0 the mixer skips it.
  }
}

const clampScale = (v: number) => Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, v));
