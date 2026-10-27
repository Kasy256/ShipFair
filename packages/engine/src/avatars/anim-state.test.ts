import { RUN_SPEED_MPS, WALK_SPEED_MPS } from '@shipfair/shared';
import { describe, expect, it } from 'vitest';
import { ANIM_CROSSFADE_S, ANIM_LAND_S, FIXED_DT_S } from '../config.ts';
import { type AnimInput, AnimState, SLOT, SLOT_NAMES } from './anim-state.ts';

const ground = (speed: number): AnimInput => ({ speed, isGrounded: true, vy: 0, isSitting: false });
const air = (vy: number): AnimInput => ({ speed: 0, isGrounded: false, vy, isSitting: false });

/** Steps `seconds` of fixed frames with the same input. */
function hold(state: AnimState, input: AnimInput, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += FIXED_DT_S) state.update(FIXED_DT_S, input);
}

const active = (state: AnimState) => {
  const slot = state.dominant();
  return slot === SLOT.emote ? state.emote : SLOT_NAMES[slot];
};

describe('animation state machine', () => {
  it('blends idle → walk → run by speed', () => {
    const s = new AnimState();
    hold(s, ground(0), 0.5);
    expect(active(s)).toBe('idle');
    hold(s, ground(WALK_SPEED_MPS), 0.5);
    expect(active(s)).toBe('walk');
    expect(s.weights[SLOT.walk]).toBeCloseTo(1);
    hold(s, ground((WALK_SPEED_MPS + RUN_SPEED_MPS) / 2), 0.5);
    expect(s.weights[SLOT.walk]).toBeCloseTo(0.5);
    expect(s.weights[SLOT.run]).toBeCloseTo(0.5);
    hold(s, ground(RUN_SPEED_MPS), 0.5);
    expect(active(s)).toBe('run');
  });

  it('crossfades over 0.2 s', () => {
    const s = new AnimState();
    hold(s, ground(RUN_SPEED_MPS), ANIM_CROSSFADE_S / 2);
    expect(s.weights[SLOT.run]).toBeCloseTo(0.5, 1);
    expect(s.weights[SLOT.idle]).toBeCloseTo(0.5, 1);
    hold(s, ground(RUN_SPEED_MPS), ANIM_CROSSFADE_S / 2 + FIXED_DT_S);
    expect(s.weights[SLOT.run]).toBe(1);
    expect(s.weights[SLOT.idle]).toBe(0);
  });

  it('jumps start → air → land → locomotion', () => {
    const s = new AnimState();
    hold(s, air(7), FIXED_DT_S);
    expect(s.mode).toBe('jump_start');
    hold(s, air(3), 0.3);
    expect(s.mode).toBe('jump_air');
    hold(s, air(-5), 0.3);
    expect(active(s)).toBe('jump_air');
    hold(s, ground(0), FIXED_DT_S);
    expect(s.mode).toBe('jump_land');
    hold(s, ground(0), ANIM_LAND_S + FIXED_DT_S);
    expect(s.mode).toBe('locomotion');
  });

  it('walking off a ledge goes straight to the air loop', () => {
    const s = new AnimState();
    hold(s, air(-1), FIXED_DT_S);
    expect(s.mode).toBe('jump_air');
  });

  it('plays a one-shot emote, then returns to idle', () => {
    const s = new AnimState();
    s.playEmote('emote_wave', 1);
    hold(s, ground(0), 0.5);
    expect(active(s)).toBe('emote_wave');
    hold(s, ground(0), 0.6 + ANIM_CROSSFADE_S);
    expect(s.mode).toBe('locomotion');
    expect(active(s)).toBe('idle');
  });

  it('loops dance until the player moves', () => {
    const s = new AnimState();
    s.playEmote('emote_dance', 1);
    hold(s, ground(0), 5);
    expect(active(s)).toBe('emote_dance');
    hold(s, ground(WALK_SPEED_MPS), 0.5);
    expect(active(s)).toBe('walk');
  });

  it('sits while asked and stands up to move', () => {
    const s = new AnimState();
    hold(s, { ...ground(0), isSitting: true }, 0.5);
    expect(active(s)).toBe('sit_idle');
    hold(s, { ...ground(WALK_SPEED_MPS), isSitting: true }, 0.5);
    expect(active(s)).toBe('walk');
  });

  it('ignores emotes mid-air', () => {
    const s = new AnimState();
    hold(s, air(5), FIXED_DT_S);
    s.playEmote('emote_wave', 1);
    expect(s.mode).toBe('jump_start');
  });
});
