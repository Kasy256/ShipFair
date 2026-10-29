import { WorldSnapshot } from '@shipfair/shared';

/** What the engine starts with: a snapshot (and where its images live), or the test level. */
export interface WorldSource {
  /** Undefined means the prompt-04 test level (`?level=test`). */
  snapshot: WorldSnapshot | undefined;
  mediaHost: string | null;
}

/** Fake booths' image keys don't exist on the real media host; e2e serves this one. */
export const FAKE_MEDIA_HOST = 'fake-media.shipfair.test';
/** Booths in the dev fallback city while `/api/world` doesn't exist yet (prompt 06). */
const DEV_FALLBACK_BOOTHS = 40;

const isDev = import.meta.env.MODE !== 'production';
const mediaHost = (import.meta.env.VITE_MEDIA_HOST as string | undefined) || null;

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

/**
 * Picks the world to build. In development `?level=test` gives the test level and
 * `?debug=fakeN` a fake city of N booths. Otherwise it is `/api/world`, parsed with the zod
 * schema; until that endpoint exists, development falls back to a small fake city and
 * production to an empty one (plaza only).
 */
export async function loadWorld(search: string): Promise<WorldSource> {
  const params = new URLSearchParams(search);
  if (isDev && params.get('level') === 'test') return { snapshot: undefined, mediaHost: null };
  const fakeCount = isDev ? fakeBoothCount(search) : undefined;
  if (fakeCount !== undefined) return fakeWorld(fakeCount);
  try {
    const response = await fetch('/api/world', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = WorldSnapshot.safeParse(await response.json());
    if (!parsed.success) throw new Error(`invalid world: ${parsed.error.message}`);
    return { snapshot: parsed.data, mediaHost };
  } catch (error) {
    console.warn('The world snapshot is unavailable; using a fallback city.', error);
    if (isDev) return fakeWorld(DEV_FALLBACK_BOOTHS);
    const empty: WorldSnapshot = {
      version: 0,
      generatedAt: new Date().toISOString(),
      districts: [],
      booths: [],
    };
    return { snapshot: empty, mediaHost };
  }
}
