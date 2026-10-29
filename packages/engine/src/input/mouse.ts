import { MOUSE_PITCH_RAD_PER_PX, MOUSE_YAW_RAD_PER_PX, WHEEL_ZOOM_M_PER_PX } from '../config.ts';
import type { InputState } from './state.ts';

/**
 * Mouse look. Clicking the canvas asks for pointer lock (Esc releases it, the browser handles
 * that); a click while locked interacts. While unlocked, dragging with a button held looks around instead. The wheel zooms.
 * Touch and pen pointers are left to the touch source.
 */
export class MouseSource {
  readonly #canvas: HTMLCanvasElement;
  readonly #state: InputState;
  readonly #isEnabled: () => boolean;
  #dragId = -1;
  #lastX = 0;
  #lastY = 0;

  constructor(canvas: HTMLCanvasElement, state: InputState, isEnabled: () => boolean) {
    this.#canvas = canvas;
    this.#state = state;
    this.#isEnabled = isEnabled;
    canvas.addEventListener('pointerdown', this.#down);
    canvas.addEventListener('click', this.#click);
    canvas.addEventListener('wheel', this.#wheel, { passive: true });
    window.addEventListener('pointermove', this.#move);
    window.addEventListener('pointerup', this.#up);
    window.addEventListener('pointercancel', this.#up);
  }

  get isLocked(): boolean {
    return document.pointerLockElement === this.#canvas;
  }

  release(): void {
    this.#dragId = -1;
    if (this.isLocked) document.exitPointerLock();
  }

  dispose(): void {
    this.release();
    const canvas = this.#canvas;
    canvas.removeEventListener('pointerdown', this.#down);
    canvas.removeEventListener('click', this.#click);
    canvas.removeEventListener('wheel', this.#wheel);
    window.removeEventListener('pointermove', this.#move);
    window.removeEventListener('pointerup', this.#up);
    window.removeEventListener('pointercancel', this.#up);
  }

  readonly #click = (e: MouseEvent): void => {
    if (!this.#isEnabled() || (e as PointerEvent).pointerType === 'touch') return;
    // Locked, a click is the interact action (open the focused booth); unlocked, it locks.
    if (this.isLocked) {
      this.#state.interact = true;
      return;
    }
    // Promise-returning in modern browsers; a refusal (e.g. right after Esc) just keeps drag-look.
    const request = this.#canvas.requestPointerLock?.() as Promise<void> | undefined;
    request?.catch?.(() => undefined);
  };

  readonly #down = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || !this.#isEnabled()) return;
    this.#dragId = e.pointerId;
    this.#lastX = e.clientX;
    this.#lastY = e.clientY;
  };

  readonly #move = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || !this.#isEnabled()) return;
    let dx = 0;
    let dy = 0;
    if (this.isLocked) {
      dx = e.movementX;
      dy = e.movementY;
    } else if (e.pointerId === this.#dragId) {
      dx = e.clientX - this.#lastX;
      dy = e.clientY - this.#lastY;
      this.#lastX = e.clientX;
      this.#lastY = e.clientY;
    } else {
      return;
    }
    this.#state.lookYaw -= dx * MOUSE_YAW_RAD_PER_PX;
    this.#state.lookPitch += dy * MOUSE_PITCH_RAD_PER_PX;
  };

  readonly #up = (e: PointerEvent): void => {
    if (e.pointerId === this.#dragId) this.#dragId = -1;
  };

  readonly #wheel = (e: WheelEvent): void => {
    if (!this.#isEnabled()) return;
    this.#state.zoom += e.deltaY * WHEEL_ZOOM_M_PER_PX;
  };
}
