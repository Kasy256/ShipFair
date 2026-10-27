import type { Engine } from '@shipfair/engine';
import { APP_NAME } from '@shipfair/shared';
import { lazy, Suspense, useState } from 'react';
import { ControlsPanel } from './ui/ControlsPanel.tsx';
import { TouchControls } from './ui/TouchControls.tsx';
import { WorldCanvas } from './ui/WorldCanvas.tsx';

// Vite replaces MODE at build time, so production bundles drop the asset page entirely.
const DevAssets =
  import.meta.env.MODE !== 'production'
    ? lazy(() => import('./dev/DevAssets.tsx').then((m) => ({ default: m.DevAssets })))
    : null;

export function App() {
  if (DevAssets && window.location.pathname === '/dev/assets') {
    return (
      <Suspense fallback={<p className="p-4">Loading…</p>}>
        <DevAssets />
      </Suspense>
    );
  }
  return <World />;
}

function World() {
  const [engine, setEngine] = useState<Engine>();
  const [isControlsOpen, setIsControlsOpen] = useState(false);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ink font-sans text-paper">
      <WorldCanvas onEngine={setEngine} />
      {engine && <TouchControls engine={engine} />}
      <header className="pointer-events-none absolute top-3 left-3 flex items-center gap-3">
        <h1 className="font-bold text-2xl text-accent tracking-tight drop-shadow">{APP_NAME}</h1>
        <button
          type="button"
          onClick={() => setIsControlsOpen(true)}
          className="pointer-events-auto rounded bg-ink/70 px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-accent"
        >
          Controls
        </button>
      </header>
      <ControlsPanel isOpen={isControlsOpen} onClose={() => setIsControlsOpen(false)} />
    </main>
  );
}
