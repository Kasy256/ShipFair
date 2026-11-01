import { RUN_SPEED_MPS, WALK_SPEED_MPS } from '@shipfair/shared';
import { LAND_SQUASH_S, STEP_EVENT_MIN_SPEED_MPS, WAVE_DURATION_S } from '../config.ts';

/**
 * Joint angles (radians) and offsets for the procedural rig. Index 0 of each pair is the rig's
 * +x side, as in the prototype. A plain struct, so the local avatar and (later) instanced remote
 * avatars share one pose function.
 */
export interface Pose {
  hipsY: number;
  chestLean: number;
  chestScaleY: number;
  hip0: number;
  hip1: number;
  knee0: number;
  knee1: number;
  shoulderX0: number;
  shoulderX1: number;
  shoulderZ0: number;
  shoulderZ1: number;
  elbowX0: number;
  elbowX1: number;
  elbowZ0: number;
}

/** Per-avatar animation memory. */
export interface PoseState {
  phase: number;
  landT: number;
  waveT: number;
  steps: number;
}

export interface Locomotion {
  speed: number;
  isGrounded: boolean;
  vy: number;
}

export const HIPS_HEIGHT_M = 0.95;
const MOVING_MPS = 0.05;
const BREATH_RAD_PER_S = 1.8;

export const createPose = (): Pose => ({
  hipsY: HIPS_HEIGHT_M,
  chestLean: 0,
  chestScaleY: 1,
  hip0: 0,
  hip1: 0,
  knee0: 0,
  knee1: 0,
  shoulderX0: 0,
  shoulderX1: 0,
  shoulderZ0: 0.07,
  shoulderZ1: -0.07,
  elbowX0: -0.1,
  elbowX1: -0.1,
  elbowZ0: 0,
});

export const createPoseState = (): PoseState => ({ phase: 0, landT: 0, waveT: 0, steps: 0 });

export function startLand(state: PoseState): void {
  state.landT = LAND_SQUASH_S;
}

export function startWave(state: PoseState): void {
  state.waveT = WAVE_DURATION_S;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Advances the walk/run cycle and writes the pose (ported from the prototype's `animate`).
 * `time` is loop time in seconds, never wall time, so idle breathing is deterministic.
 * Returns true on a footstep (the stride crosses the midline while moving).
 */
export function advancePose(
  state: PoseState,
  motion: Locomotion,
  dt: number,
  time: number,
  out: Pose,
): boolean {
  const sp = motion.speed;
  const k = Math.min(1, sp / WALK_SPEED_MPS);
  const runK = clamp01((sp - WALK_SPEED_MPS) / (RUN_SPEED_MPS - WALK_SPEED_MPS));
  let hasStepped = false;
  out.chestScaleY = 1;
  out.elbowZ0 = 0;

  if (!motion.isGrounded) {
    const isRising = motion.vy > 0;
    out.hip0 = isRising ? -0.2 : -0.45;
    out.hip1 = isRising ? -0.9 : -0.45;
    out.knee0 = isRising ? 0.4 : 0.6;
    out.knee1 = isRising ? 1.3 : 0.6;
    out.shoulderX0 = -0.6;
    out.shoulderX1 = -0.6;
    out.shoulderZ0 = 0.9;
    out.shoulderZ1 = -0.9;
    out.elbowX0 = -0.4;
    out.elbowX1 = -0.4;
    out.chestLean = 0.1;
    out.hipsY = HIPS_HEIGHT_M;
  } else {
    const stride = 1 + runK * 0.6;
    const before = Math.sin(state.phase);
    if (sp > MOVING_MPS) state.phase += dt * (5.4 + runK * 4.2) * Math.max(0.5, k);
    const s = Math.sin(state.phase);
    if (Math.sign(before) !== Math.sign(s) && sp > STEP_EVENT_MIN_SPEED_MPS) {
      state.steps++;
      hasStepped = true;
    }
    const swing = s * 0.5 * k * stride;
    const kneeBend = (0.9 + runK * 0.8) * k;
    out.hip0 = -swing;
    out.hip1 = swing;
    out.knee0 = Math.max(0, Math.sin(state.phase + 1.7)) * kneeBend + 0.04;
    out.knee1 = Math.max(0, Math.sin(state.phase + Math.PI + 1.7)) * kneeBend + 0.04;
    out.shoulderX0 = swing;
    out.shoulderX1 = -swing;
    out.shoulderZ0 = 0.07;
    out.shoulderZ1 = -0.07;
    out.elbowX0 = -0.15 - runK * 1.1;
    out.elbowX1 = out.elbowX0;
    out.chestLean = 0.05 * k + runK * 0.12;
    const bob = Math.abs(Math.cos(state.phase)) * 0.035 * k * stride;
    out.hipsY = HIPS_HEIGHT_M - bob - (state.landT > 0 ? state.landT * 0.6 : 0);
    if (sp < MOVING_MPS) {
      const breath = Math.sin(time * BREATH_RAD_PER_S);
      out.chestScaleY = 1 + breath * 0.01;
      out.shoulderX0 = breath * 0.03;
      out.shoulderX1 = breath * 0.03;
      out.elbowX0 = -0.1;
      out.elbowX1 = -0.1;
    }
  }
  state.landT = Math.max(0, state.landT - dt);

  if (state.waveT > 0) {
    state.waveT = Math.max(0, state.waveT - dt);
    out.shoulderX0 = -0.3;
    out.shoulderZ0 = 2.6;
    out.elbowX0 = 0;
    out.elbowZ0 = Math.sin(state.waveT * 14) * 0.5;
  }
  return hasStepped;
}

/** How long a stand-in holds an emote (the glTF clips have their own lengths); dance loops. */
export const STAND_IN_EMOTE_S = 2.2;
/** Emote ids that loop until the player moves (EMOTE_CLIPS order: dance). */
export const isLoopingEmote = (emote: number): boolean => emote === 2;

/**
 * Procedural stand-ins for the emote clips (EMOTE_CLIPS order: wave, clap, dance, cheer, point,
 * sit), applied over the locomotion pose. `t` is seconds since the emote started.
 */
export function applyEmotePose(emote: number, t: number, out: Pose): void {
  const beat = Math.sin(t * 10);
  switch (emote) {
    case 0: // wave
      out.shoulderX0 = -0.3;
      out.shoulderZ0 = 2.6;
      out.elbowZ0 = Math.sin(t * 14) * 0.5;
      return;
    case 1: // clap
      out.shoulderX0 = -1.25;
      out.shoulderX1 = -1.25;
      out.shoulderZ0 = -0.15 - Math.abs(beat) * 0.2;
      out.shoulderZ1 = 0.15 + Math.abs(beat) * 0.2;
      return;
    case 2: // dance
      out.shoulderZ0 = 2.1 + beat * 0.4;
      out.shoulderZ1 = -2.1 + beat * 0.4;
      out.hipsY -= Math.abs(beat) * 0.06;
      out.chestLean = beat * 0.08;
      return;
    case 3: // cheer
      out.shoulderZ0 = 2.8;
      out.shoulderZ1 = -2.8;
      out.hipsY += Math.max(0, beat) * 0.05;
      return;
    case 4: // point
      out.shoulderX0 = -1.5;
      out.shoulderZ0 = 0.05;
      return;
    case 5: // sit
      out.hipsY = HIPS_HEIGHT_M * 0.5;
      out.hip0 = -1.45;
      out.hip1 = -1.45;
      out.knee0 = 1.45;
      out.knee1 = 1.45;
      return;
  }
}
