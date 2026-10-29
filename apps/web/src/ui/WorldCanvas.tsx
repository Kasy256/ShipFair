import type { Engine, StartStage } from '@shipfair/engine';
import { useEffect, useRef, useState } from 'react';
import { loadEngineModule } from '../lib/engine-loader.ts';
import type { WorldSource } from '../lib/world-source.ts';
import { engineBus } from '../state/engine-bus.ts';
import { useUiStore } from '../state/ui-store.ts';

type Status = 'loading' | 'ready' | 'error';

interface WorldCanvasProps {
  /** Nothing is built until the world source has loaded. */
  source: WorldSource | undefined;
  onStage: (stage: StartStage) => void;
  onEngine: (engine: Engine | undefined) => void;
  onError: () => void;
}

/**
 * Mounts the engine on a full-screen canvas and builds the world from `source`. The engine
 * module is imported on demand (see lib/engine-loader.ts). `?quality=high|low` forces a tier,
 * `?debug=perf` and `?debug=physics` turn on the overlays, and `?test` starts in deterministic
 * test mode (no rAF; Playwright drives it through `window.__shipfair.step`).
 */
export function WorldCanvas({ source, onStage, onEngine, onError }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  // The latest callbacks, so a parent re-render never restarts the engine.
  const callbacks = useRef({ onStage, onEngine, onError });
  callbacks.current = { onStage, onEngine, onError };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    const search = window.location.search;
    const isTestMode = new URLSearchParams(search).has('test');
    let engine: Engine | undefined;
    let isCurrent = true;
    loadEngineModule()
      .then(async (mod) => {
        if (!isCurrent) return;
        const forcedTier = mod.tierFromQuery(search);
        const started = new mod.Engine({
          canvas,
          bus: engineBus,
          quality: forcedTier ?? mod.guessTier(mod.readDeviceInfo()),
          isAutoQuality: forcedTier === undefined && !isTestMode,
          isTestMode,
          debug: mod.debugFlags(search),
          mediaHost: source.mediaHost,
          isReducedMotion: useUiStore.getState().isReducedMotion,
        });
        engine = started;
        await started.start(source.snapshot, (stage) => {
          if (isCurrent) callbacks.current.onStage(stage);
        });
        if (!isCurrent || started.isDisposed) return;
        // Vite replaces MODE at build time, so production bundles drop this branch entirely.
        if (import.meta.env.MODE !== 'production') window.__shipfair = mod.createTestApi(started);
        setStatus('ready');
        callbacks.current.onEngine(started);
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        console.error('Engine failed to start', error);
        setStatus('error');
        callbacks.current.onError();
      });
    return () => {
      isCurrent = false;
      callbacks.current.onEngine(undefined);
      if (import.meta.env.MODE !== 'production' && engine && window.__shipfair?.engine === engine) {
        delete window.__shipfair;
      }
      engine?.dispose();
    };
  }, [source]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 block h-full w-full outline-none"
      data-testid="world-canvas"
      data-status={status}
      aria-label="3D world. Click to look around with the mouse; move with WASD or the arrow keys."
    />
  );
}
