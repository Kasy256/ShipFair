import type { InputState } from './state.ts';

export type InputAction = 'jump' | 'interact' | 'wave';

const FORWARD = ['KeyW', 'ArrowUp'] as const;
const BACK = ['KeyS', 'ArrowDown'] as const;
const LEFT = ['KeyA', 'ArrowLeft'] as const;
const RIGHT = ['KeyD', 'ArrowRight'] as const;
const RUN = ['ShiftLeft', 'ShiftRight'] as const;

/** Press-once keys (`KeyboardEvent.code`) and the action each triggers. */
export const ACTION_KEYS: Readonly<Record<string, InputAction>> = {
  Space: 'jump',
  KeyE: 'interact',
  KeyF: 'wave',
};

/** Keys 1–6 play the emotes in EMOTE_CLIPS order (wave, clap, dance, cheer, point, sit). */
export const EMOTE_KEYS: Readonly<Record<string, number>> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Digit5: 4,
  Digit6: 5,
};

/** Keys the page must not act on (scrolling) while the world has focus. */
const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const anyHeld = (keys: ReadonlySet<string>, codes: readonly string[]) => {
  for (const code of codes) if (keys.has(code)) return true;
  return false;
};

/** Pure mapping from held keys to the move axes and run flag (adds to what's already there). */
export function applyKeys(keys: ReadonlySet<string>, state: InputState): void {
  state.moveY += (anyHeld(keys, FORWARD) ? 1 : 0) - (anyHeld(keys, BACK) ? 1 : 0);
  state.moveX += (anyHeld(keys, RIGHT) ? 1 : 0) - (anyHeld(keys, LEFT) ? 1 : 0);
  if (anyHeld(keys, RUN)) state.run = true;
}

/** True when a key event belongs to a text field, so typing never moves the avatar. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Partial<HTMLElement>).tagName !== 'string') return false;
  const el = target as HTMLElement;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  );
}

/** Tracks held keys on `window` and reports press-once actions. */
export class KeyboardSource {
  readonly held = new Set<string>();
  readonly #onAction: (action: InputAction) => void;
  readonly #onEmote: (emote: number) => void;
  readonly #target: Window;

  constructor(
    target: Window,
    onAction: (action: InputAction) => void,
    onEmote: (emote: number) => void,
  ) {
    this.#target = target;
    this.#onAction = onAction;
    this.#onEmote = onEmote;
    target.addEventListener('keydown', this.#down);
    target.addEventListener('keyup', this.#up);
    target.addEventListener('blur', this.#clear);
  }

  apply(state: InputState): void {
    applyKeys(this.held, state);
  }

  clear(): void {
    this.held.clear();
  }

  dispose(): void {
    this.#target.removeEventListener('keydown', this.#down);
    this.#target.removeEventListener('keyup', this.#up);
    this.#target.removeEventListener('blur', this.#clear);
    this.held.clear();
  }

  readonly #down = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    this.held.add(e.code);
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    const action = ACTION_KEYS[e.code];
    if (action && !e.repeat) this.#onAction(action);
    const emote = EMOTE_KEYS[e.code];
    if (emote !== undefined && !e.repeat) this.#onEmote(emote);
  };

  readonly #up = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  readonly #clear = (): void => {
    this.held.clear();
  };
}
