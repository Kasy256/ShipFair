import {
  JOYSTICK_DEADZONE,
  JOYSTICK_RADIUS_PX,
  JOYSTICK_RUN_AT,
  TOUCH_LOOK_RAD_PER_PX,
} from '../config.ts';
import type { InputState } from './state.ts';

export interface JoystickReading {
  x: number;
  y: number;
  isRunning: boolean;
}

/**
 * Pure stick math. `dx`, `dy` are the finger's offset from where it landed, in CSS px (screen y
 * points down). Output is a move vector in the unit disc, rescaled past the deadzone so small
 * pushes still give fine control; pushing to the rim runs.
 */
export function readJoystick(
  dx: number,
  dy: number,
  out: JoystickReading,
  radius = JOYSTICK_RADIUS_PX,
): JoystickReading {
  const len = Math.hypot(dx, dy);
  const push = Math.min(1, len / radius);
  if (push < JOYSTICK_DEADZONE || len === 0) {
    out.x = 0;
    out.y = 0;
    out.isRunning = false;
    return out;
  }
  const scaled = (push - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
  out.x = (dx / len) * scaled;
  out.y = (-dy / len) * scaled;
  out.isRunning = push >= JOYSTICK_RUN_AT;
  return out;
}

/** Where to draw the stick, in client px. Sent on pointer events only, never per frame. */
export interface JoystickView {
  isActive: boolean;
  baseX: number;
  baseY: number;
  knobX: number;
  knobY: number;
  radius: number;
}

/**
 * Touch controls (new work: the prototype had none). A finger landing on the left half of the
 * canvas becomes a floating joystick; one on the right half drags the camera. The UI draws the
 * stick from `onJoystick` and renders the jump and interact buttons itself.
 */
export class TouchSource {
  readonly #canvas: HTMLCanvasElement;
  readonly #state: InputState;
  readonly #isEnabled: () => boolean;
  readonly #reading: JoystickReading = { x: 0, y: 0, isRunning: false };
  readonly #view: JoystickView = {
    isActive: false,
    baseX: 0,
    baseY: 0,
    knobX: 0,
    knobY: 0,
    radius: JOYSTICK_RADIUS_PX,
  };
  #stickId = -1;
  #lookId = -1;
  #lookX = 0;
  #lookY = 0;
  onJoystick: ((view: Readonly<JoystickView>) => void) | undefined;

  constructor(canvas: HTMLCanvasElement, state: InputState, isEnabled: () => boolean) {
    this.#canvas = canvas;
    this.#state = state;
    this.#isEnabled = isEnabled;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.#down);
    window.addEventListener('pointermove', this.#move);
    window.addEventListener('pointerup', this.#up);
    window.addEventListener('pointercancel', this.#up);
  }

  get isActive(): boolean {
    return this.#stickId >= 0 || this.#lookId >= 0;
  }

  /** Adds the stick to the move axes. */
  apply(state: InputState): void {
    if (this.#stickId < 0) return;
    state.moveX += this.#reading.x;
    state.moveY += this.#reading.y;
    if (this.#reading.isRunning) state.run = true;
  }

  release(): void {
    this.#stickId = -1;
    this.#lookId = -1;
    this.#reading.x = 0;
    this.#reading.y = 0;
    this.#reading.isRunning = false;
    this.#publish(false);
  }

  dispose(): void {
    this.release();
    this.onJoystick = undefined;
    this.#canvas.removeEventListener('pointerdown', this.#down);
    window.removeEventListener('pointermove', this.#move);
    window.removeEventListener('pointerup', this.#up);
    window.removeEventListener('pointercancel', this.#up);
  }

  readonly #down = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' || !this.#isEnabled()) return;
    const rect = this.#canvas.getBoundingClientRect();
    const isLeftHalf = e.clientX < rect.left + rect.width / 2;
    if (isLeftHalf && this.#stickId < 0) {
      this.#stickId = e.pointerId;
      this.#view.baseX = e.clientX;
      this.#view.baseY = e.clientY;
      readJoystick(0, 0, this.#reading);
      this.#publish(true, e.clientX, e.clientY);
    } else if (!isLeftHalf && this.#lookId < 0) {
      this.#lookId = e.pointerId;
      this.#lookX = e.clientX;
      this.#lookY = e.clientY;
    }
  };

  readonly #move = (e: PointerEvent): void => {
    if (e.pointerId === this.#stickId) {
      const dx = e.clientX - this.#view.baseX;
      const dy = e.clientY - this.#view.baseY;
      readJoystick(dx, dy, this.#reading);
      const len = Math.hypot(dx, dy);
      const k = len > JOYSTICK_RADIUS_PX ? JOYSTICK_RADIUS_PX / len : 1;
      this.#publish(true, this.#view.baseX + dx * k, this.#view.baseY + dy * k);
    } else if (e.pointerId === this.#lookId && this.#isEnabled()) {
      this.#state.lookYaw -= (e.clientX - this.#lookX) * TOUCH_LOOK_RAD_PER_PX;
      this.#state.lookPitch += (e.clientY - this.#lookY) * TOUCH_LOOK_RAD_PER_PX;
      this.#lookX = e.clientX;
      this.#lookY = e.clientY;
    }
  };

  readonly #up = (e: PointerEvent): void => {
    if (e.pointerId === this.#stickId) {
      this.#stickId = -1;
      readJoystick(0, 0, this.#reading);
      this.#publish(false);
    } else if (e.pointerId === this.#lookId) {
      this.#lookId = -1;
    }
  };

  #publish(isActive: boolean, knobX = this.#view.baseX, knobY = this.#view.baseY): void {
    const view = this.#view;
    view.isActive = isActive;
    view.knobX = knobX;
    view.knobY = knobY;
    this.onJoystick?.(view);
  }
}
