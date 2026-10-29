import type { WorldErrorCode } from '../lib/world-source.ts';

/** Friendly text for error codes: what went wrong and what to do (CODING_STANDARDS.md §3). */
const WORLD_ERRORS: Record<WorldErrorCode | 'engine', string> = {
  world_unavailable: "The city's booth list isn't loading right now. Try again in a moment.",
  invalid_world:
    'The city data came back damaged. Try again; if it keeps happening, reload the page.',
  network: "We couldn't reach the server. Check your connection and try again.",
  engine:
    "The 3D world couldn't start. Your browser may have WebGL turned off; try another browser or reload the page.",
};

export function worldErrorText(code: WorldErrorCode | 'engine'): string {
  return WORLD_ERRORS[code];
}
