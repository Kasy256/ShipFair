/** True on touch-first devices (phones, tablets): tap prompts and on-screen controls. */
export const isCoarsePointer = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/** How long the touch Use button buzzes (ms): a tick, not a buzz. */
const HAPTIC_TICK_MS = 10;

/** A short vibration on interact, where the browser supports it (Android Chrome; not iOS). */
export function hapticTick(): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(HAPTIC_TICK_MS);
  }
}

export const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Typing in a field must never trigger world shortcuts (M, ?). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
