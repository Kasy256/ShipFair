import type { Engine, PlayerView } from '@shipfair/engine';

/**
 * The latest player pose, shared by the minimap (every frame) and the map's "You are here"
 * marker. The engine has one frame listener; this fans it out without re-rendering React.
 */
export const playerView: PlayerView & { hasData: boolean } = {
  x: 0,
  z: 0,
  yaw: 0,
  cameraYaw: 0,
  hasData: false,
};

const listeners = new Set<() => void>();

export function onPlayerView(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Starts copying the engine's frames into `playerView`; returns the detach function. */
export function attachPlayerView(engine: Engine): () => void {
  engine.onFrame((view) => {
    playerView.x = view.x;
    playerView.z = view.z;
    playerView.yaw = view.yaw;
    playerView.cameraYaw = view.cameraYaw;
    playerView.hasData = true;
    for (const listener of listeners) listener();
  });
  return () => {
    engine.onFrame(undefined);
    playerView.hasData = false;
  };
}
