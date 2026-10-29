// The engine (Three.js + Rapier) is the heaviest chunk. It is imported on demand so the loading
// screen paints first and the download runs in parallel with the world fetch.
type EngineModule = typeof import('@shipfair/engine');

let pending: Promise<EngineModule> | undefined;

export function loadEngineModule(): Promise<EngineModule> {
  pending ??= import('@shipfair/engine').catch((error: unknown) => {
    pending = undefined; // let "Retry" try again
    throw error;
  });
  return pending;
}
