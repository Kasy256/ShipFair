/**
 * What the player wants this frame, merged from every input source. Systems read it; only the
 * input manager writes it. Axes are analog in [-1, 1]; `jump`, `interact` and `wave` are
 * presses that stay set until the system that acts on them clears them.
 */
export interface InputState {
  /** Strafe: +1 is right. */
  moveX: number;
  /** +1 is forward (away from the camera). */
  moveY: number;
  run: boolean;
  jump: boolean;
  interact: boolean;
  wave: boolean;
  /** Camera deltas in radians, summed since the camera last consumed them. */
  lookYaw: number;
  lookPitch: number;
  /** Camera zoom delta in metres (positive moves the camera out). */
  zoom: number;
}

export function createInputState(): InputState {
  return {
    moveX: 0,
    moveY: 0,
    run: false,
    jump: false,
    interact: false,
    wave: false,
    lookYaw: 0,
    lookPitch: 0,
    zoom: 0,
  };
}

export function resetInputState(state: InputState): void {
  state.moveX = 0;
  state.moveY = 0;
  state.run = false;
  state.jump = false;
  state.interact = false;
  state.wave = false;
  state.lookYaw = 0;
  state.lookPitch = 0;
  state.zoom = 0;
}

/** Clamps a move vector to the unit disc, so diagonals are never faster than straight lines. */
export function clampMove(state: InputState): void {
  const len = Math.hypot(state.moveX, state.moveY);
  if (len > 1) {
    state.moveX /= len;
    state.moveY /= len;
  }
}
