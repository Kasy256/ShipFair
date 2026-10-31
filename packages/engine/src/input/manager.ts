import type { System } from '../core/loop.ts';
import { GamepadSource } from './gamepad.ts';
import { type InputAction, KeyboardSource } from './keyboard.ts';
import { MouseSource } from './mouse.ts';
import { clampMove, createInputState, type InputState, resetInputState } from './state.ts';
import { TouchSource } from './touch.ts';

/** Move axes written by code instead of a device: e2e tests now, maybe an autopilot later. */
export interface ScriptedMove {
  isActive: boolean;
  moveX: number;
  moveY: number;
  run: boolean;
}

/**
 * Merges keyboard, mouse, touch, gamepad and scripted input into one `InputState`. Axes are
 * re-sampled at the start of every fixed step so movement reacts within the same frame. While
 * disabled (a UI panel is open), the state stays zeroed and pointer lock is released.
 */
export class InputManager implements System {
  readonly state: InputState = createInputState();
  readonly script: ScriptedMove = { isActive: false, moveX: 0, moveY: 0, run: false };
  readonly keyboard: KeyboardSource;
  readonly mouse: MouseSource;
  readonly touch: TouchSource;
  readonly gamepad: GamepadSource;
  #isEnabled = true;

  constructor(canvas: HTMLCanvasElement) {
    const isEnabled = () => this.#isEnabled;
    this.keyboard = new KeyboardSource(window, this.press, this.emote);
    this.mouse = new MouseSource(canvas, this.state, isEnabled);
    this.touch = new TouchSource(canvas, this.state, isEnabled);
    this.gamepad = new GamepadSource(this.press);
  }

  get isEnabled(): boolean {
    return this.#isEnabled;
  }

  setEnabled(enabled: boolean): void {
    this.#isEnabled = enabled;
    if (enabled) return;
    resetInputState(this.state);
    this.keyboard.clear();
    this.touch.release();
    this.mouse.release();
  }

  /** A press-once action from a key, a pad button or an on-screen button. */
  readonly press = (action: InputAction): void => {
    if (!this.#isEnabled) return;
    this.state[action] = true;
  };

  /** An emote from keys 1–6. The bus `emote` event (touch menu) goes straight to the engine. */
  readonly emote = (emote: number): void => {
    if (!this.#isEnabled) return;
    this.state.emote = emote;
  };

  fixedUpdate(dt: number): void {
    const state = this.state;
    state.moveX = 0;
    state.moveY = 0;
    state.run = false;
    if (!this.#isEnabled) return;
    this.keyboard.apply(state);
    this.touch.apply(state);
    this.gamepad.apply(state, dt);
    const script = this.script;
    if (script.isActive) {
      state.moveX += script.moveX;
      state.moveY += script.moveY;
      if (script.run) state.run = true;
    }
    clampMove(state);
  }

  dispose(): void {
    this.keyboard.dispose();
    this.mouse.dispose();
    this.touch.dispose();
    this.gamepad.dispose();
    resetInputState(this.state);
  }
}

export type { InputAction };
