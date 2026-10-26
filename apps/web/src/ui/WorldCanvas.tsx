import {
  createTestApi,
  debugFlags,
  Engine,
  guessTier,
  readDeviceInfo,
  tierFromQuery,
} from '@shipfair/engine';
import { useEffect, useRef, useState } from 'react';
import { engineBus } from '../state/engine-bus.ts';

type Status = 'loading' | 'ready' | 'error';

interface WorldCanvasProps {
  onEngine?: (engine: Engine | undefined) => void;
}

/**
 * Mounts the engine on a full-screen canvas. `?quality=high|low` forces a tier, `?debug=perf`
 * and `?debug=physics` turn on the overlays, and `?test` starts in deterministic test mode
 * (no rAF; Playwright drives it through `window.__shipfair.step`).
 */
export function WorldCanvas({ onEngine }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const forcedTier = tierFromQuery(search);
    const isTestMode = params.has('test');
    const engine = new Engine({
      canvas,
      bus: engineBus,
      quality: forcedTier ?? guessTier(readDeviceInfo()),
      isAutoQuality: forcedTier === undefined && !isTestMode,
      isTestMode,
      debug: debugFlags(search),
    });
    let isCurrent = true;
    engine
      .start()
      .then(() => {
        if (!isCurrent) return;
        // Vite replaces MODE at build time, so production bundles drop this branch entirely.
        if (import.meta.env.MODE !== 'production') window.__shipfair = createTestApi(engine);
        setStatus('ready');
        onEngine?.(engine);
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        console.error('Engine failed to start', error);
        setStatus('error');
      });
    return () => {
      isCurrent = false;
      onEngine?.(undefined);
      if (import.meta.env.MODE !== 'production' && window.__shipfair?.engine === engine) {
        delete window.__shipfair;
      }
      engine.dispose();
    };
  }, [onEngine]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full outline-none"
        data-testid="world-canvas"
        data-status={status}
        aria-label="3D world. Click to look around with the mouse; move with WASD or the arrow keys."
      />
      {status === 'loading' && (
        <p className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-sm opacity-80">
          Loading the world…
        </p>
      )}
      {status === 'error' && (
        <p
          role="alert"
          className="absolute inset-x-0 bottom-8 mx-auto max-w-md rounded bg-ink/90 p-3 text-center"
        >
          The 3D world couldn't start. Your browser may have WebGL turned off; try another browser
          or reload the page.
        </p>
      )}
    </>
  );
}
