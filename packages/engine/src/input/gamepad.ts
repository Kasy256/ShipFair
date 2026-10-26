import { GAMEPAD_DEADZONE, GAMEPAD_LOOK_RAD_PER_S } from '../config.ts';
import type { InputAction } from './keyboard.ts';
import type { InputState } from './state.ts';

// Standard mapping (https://w3c.github.io/gamepad/#remapping)
const BUTTON_A = 0;
const BUTTON_X = 2;
const BUTTON_Y = 3;
const LEFT_STICK_PRESS = 10;

export const deadzone = (v: number): number =>
  Math.abs(v) < GAMEPAD_DEADZONE
    ? 0
    : (Math.sign(v) * (Math.abs(v) - GAMEPAD_DEADZONE)) / (1 - GAMEPAD_DEADZONE);

/**
 * Optional gamepad: left stick moves, right stick looks, A jumps, X interacts, Y waves, clicking
 * the left stick runs. Polled only while a pad is connected (`getGamepads()` returns a fresh
 * array on every call in Chromium, so it isn't free).
 */
export class GamepadSource {
  readonly #onAction: (action: InputAction) => void;
  #connected = 0;
  #wasDown = 0; // bit per action button, for press edges

  constructor(onAction: (action: InputAction) => void) {
    this.#onAction = onAction;
    window.addEventListener('gamepadconnected', this.#connect);
    window.addEventListener('gamepaddisconnected', this.#disconnect);
  }

  apply(state: InputState, dt: number): void {
    if (this.#connected === 0) return;
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (pad?.mapping !== 'standard') continue;
      state.moveX += deadzone(pad.axes[0] ?? 0);
      state.moveY -= deadzone(pad.axes[1] ?? 0);
      state.lookYaw -= deadzone(pad.axes[2] ?? 0) * GAMEPAD_LOOK_RAD_PER_S * dt;
      state.lookPitch += deadzone(pad.axes[3] ?? 0) * GAMEPAD_LOOK_RAD_PER_S * dt;
      if (pad.buttons[LEFT_STICK_PRESS]?.pressed) state.run = true;
      this.#edge(pad, BUTTON_A, 1, 'jump');
      this.#edge(pad, BUTTON_X, 2, 'interact');
      this.#edge(pad, BUTTON_Y, 4, 'wave');
      return; // the first standard pad wins
    }
  }

  dispose(): void {
    window.removeEventListener('gamepadconnected', this.#connect);
    window.removeEventListener('gamepaddisconnected', this.#disconnect);
  }

  #edge(pad: Gamepad, button: number, bit: number, action: InputAction): void {
    const isDown = pad.buttons[button]?.pressed === true;
    if (isDown && (this.#wasDown & bit) === 0) this.#onAction(action);
    this.#wasDown = isDown ? this.#wasDown | bit : this.#wasDown & ~bit;
  }

  readonly #connect = (): void => {
    this.#connected++;
  };

  readonly #disconnect = (): void => {
    this.#connected = Math.max(0, this.#connected - 1);
  };
}
