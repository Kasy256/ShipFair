import { WorldSnapshot } from '@shipfair/shared';

/** What the engine starts with: a snapshot (and where its images live), or the test level. */
export interface WorldSource {
  /** Undefined means the prompt-04 test level (`?level=test`). */
  snapshot: WorldSnapshot | undefined;
  mediaHost: string | null;
}

/** Fake booths' image keys don't exist on the real media host; e2e serves this one. */
export const FAKE_MEDIA_HOST = 'fake-media.shipfair.test';

const isDev = import.meta.env.MODE !== 'production';
/**
 * Where approved booth images live. In development without VITE_MEDIA_HOST it is this origin: the
 * dev Worker serves `/u/…` from the local R2 bucket (worker/dev.ts), on whichever port Vite runs.
 */
export const mediaHost =
  (import.meta.env.VITE_MEDIA_HOST as string | undefined) ||
  (import.meta.env.DEV && typeof window !== 'undefined' ? window.location.host : null);

/** Why the world didn't load. The UI maps these to friendly text in `ui/errors.ts`. */
export type WorldErrorCode = 'world_unavailable' | 'invalid_world' | 'network';

export class WorldLoadError extends Error {
  readonly code: WorldErrorCode;

  constructor(code: WorldErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorldLoadError';
    this.code = code;
  }
}

/** `?debug=fake500` → 500 (any `fakeN` among the comma-separated debug flags). */
export function fakeBoothCount(search: string): number | undefined {
  for (const value of new URLSearchParams(search).getAll('debug')) {
    for (const part of value.split(',')) {
      const match = /^fake(\d{1,4})$/.exec(part);
      if (match) return Number(match[1]);
    }
  }
  return undefined;
}

async function fakeWorld(count: number): Promise<WorldSource> {
  const fake = await import('@shipfair/shared/fake-world');
  return { snapshot: fake.fakeWorld(count), mediaHost: FAKE_MEDIA_HOST };
}

async function fetchWorld(): Promise<WorldSource> {
  let response: Response;
  try {
    response = await fetch('/api/world', { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new WorldLoadError('network', 'The world request failed', { cause: error });
  }
  if (!response.ok) {
    throw new WorldLoadError('world_unavailable', `GET /api/world answered ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new WorldLoadError('invalid_world', 'The world is not JSON', { cause: error });
  }
  const parsed = WorldSnapshot.safeParse(body);
  if (!parsed.success) {
    throw new WorldLoadError('invalid_world', 'The world failed validation', {
      cause: parsed.error,
    });
  }
  return { snapshot: parsed.data, mediaHost };
}

/**
 * Picks the world to build. In development `?level=test` gives the test level and
 * `?debug=fakeN` a fake city of N booths. Otherwise it is `/api/world`, parsed with the zod
 * schema; failures throw a `WorldLoadError` so the loading screen can offer "Retry".
 */
export async function loadWorld(search: string): Promise<WorldSource> {
  const params = new URLSearchParams(search);
  if (isDev && params.get('level') === 'test') return { snapshot: undefined, mediaHost: null };
  const fakeCount = isDev ? fakeBoothCount(search) : undefined;
  if (fakeCount !== undefined) return fakeWorld(fakeCount);
  return fetchWorld();
}
