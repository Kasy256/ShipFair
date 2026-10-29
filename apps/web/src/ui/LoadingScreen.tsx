import { APP_NAME, APP_TAGLINE } from '@shipfair/shared';
import { useEffect, useRef, useState } from 'react';

/** Boot progress: the world fetch (with the engine download), then the engine's own stages. */
export type LoadStage = 'world' | 'physics' | 'city' | 'shaders' | 'ready';

const STAGES: Record<LoadStage, { label: string; percent: number }> = {
  world: { label: 'Fetching the city', percent: 8 },
  physics: { label: 'Starting physics', percent: 40 },
  city: { label: 'Building the streets and booths', percent: 55 },
  shaders: { label: 'Warming up shaders', percent: 82 },
  ready: { label: 'Ready', percent: 100 },
};

const TIPS = [
  'Walk up to a booth and press E (or tap) to see what the maker built.',
  'Press M for the map: search any booth and jump straight to it.',
  'Every booth has a share link. Send one to a friend and they spawn right in front of it.',
  'Booths grow from stall to booth to pavilion as visitors come by. It is earned, never bought.',
  'Hold Shift to run. Press ? any time to see the controls.',
];

interface LoadingScreenProps {
  stage: LoadStage;
  /** Friendly error text; shows the Retry button instead of progress. */
  error: string | null;
  /** Shown under the error in development only (how to get a local world). */
  devHint: string | null;
  boothCount: number | null;
  onRetry: () => void;
  onEnter: () => void;
}

/**
 * Brand, a progress bar driven by the real boot stages, a tip, and "Enter". The click on Enter
 * is the user gesture that unlocks audio, and it hands keyboard focus to the world.
 */
export function LoadingScreen({
  stage,
  error,
  devHint,
  boothCount,
  onRetry,
  onEnter,
}: LoadingScreenProps) {
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)] ?? TIPS[0]);
  const enterRef = useRef<HTMLButtonElement>(null);
  const isReady = stage === 'ready' && !error;
  const { label, percent } = STAGES[stage];

  useEffect(() => {
    if (isReady) enterRef.current?.focus();
  }, [isReady]);

  return (
    <section
      aria-labelledby="loading-title"
      data-testid="loading-screen"
      className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-ink/95 px-4 text-center"
    >
      <h1 id="loading-title" className="font-bold text-5xl text-accent tracking-tight sm:text-6xl">
        {APP_NAME}
      </h1>
      <p className="mt-3 max-w-md text-muted">{APP_TAGLINE}</p>

      {error ? (
        <div role="alert" className="mt-10 max-w-md rounded-xl bg-ink-3 p-4">
          <p>{error}</p>
          {devHint && <p className="mt-2 text-muted text-sm">{devHint}</p>}
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg bg-accent px-5 py-2 font-semibold text-ink"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="mt-10 w-full max-w-sm">
          <div
            role="progressbar"
            aria-label="Loading the city"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={label}
            className="h-2 overflow-hidden rounded-full bg-ink-3"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2 text-muted text-sm" aria-live="polite">
            {label}
            {stage === 'city' && boothCount !== null ? ` (${boothCount} booths)` : ''}
            {isReady ? '' : '…'}
          </p>
          <button
            ref={enterRef}
            type="button"
            onClick={onEnter}
            disabled={!isReady}
            className="mt-8 rounded-xl bg-accent px-10 py-3 font-bold text-ink text-lg transition-opacity disabled:cursor-wait disabled:opacity-40"
          >
            Enter
          </button>
        </div>
      )}

      <p className="absolute inset-x-4 bottom-6 mx-auto max-w-lg text-muted text-sm">
        <span className="font-semibold text-paper">Tip:</span> {tip}
      </p>
    </section>
  );
}
