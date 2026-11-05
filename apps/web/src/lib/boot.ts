import type { QueryClient } from '@tanstack/react-query';
import { worldQueryOptions } from '../state/use-world-query.ts';
import { loadEngineModule } from './engine-loader.ts';

// A first visit to the city spends its bandwidth and main thread on what walking in needs: the
// world, the engine and Rapier. Everything else (Supabase, ~55 kB gzipped) waits until the city
// is ready, or AUTH_DEFER_MAX_MS, whichever comes first. Other pages don't wait.

/** Never hold sign-in back longer than this, even if the city is still loading. */
const AUTH_DEFER_MAX_MS = 15_000;

/** The routes that show the city (one engine for all three, see router.tsx). */
export function isWorldPath(pathname: string): boolean {
  return pathname === '/' || /^\/[bd]\/[^/]+\/?$/.test(pathname);
}

let markBooted: () => void = () => undefined;
const booted = new Promise<void>((resolve) => {
  markBooted = resolve;
});
let isWaiting = false;

/**
 * Called from main.tsx before React renders. On a world route it starts the engine chunk (with
 * three and Rapier), Rapier's WASM compile and `/api/world` at once, so none of them waits for
 * React's first commit or for each other.
 */
export function startBoot(pathname: string, search: string, queryClient: QueryClient): void {
  if (!isWorldPath(pathname)) {
    markBooted();
    return;
  }
  isWaiting = true;
  setTimeout(() => markBooted(), AUTH_DEFER_MAX_MS);
  void queryClient.prefetchQuery(worldQueryOptions(search));
  // A failure here resurfaces (and is shown) when the world canvas awaits the same import.
  loadEngineModule()
    .then((engine) => engine.initPhysics())
    .catch(() => undefined);
}

/** The city is ready to enter, or failed: deferred work may start. */
export function worldBooted(): void {
  markBooted();
}

/** Resolves once the city has booted (at once on other pages). */
export function afterWorldBoot(): Promise<void> {
  return isWaiting ? booted : Promise.resolve();
}
