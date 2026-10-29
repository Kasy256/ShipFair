import type { Engine } from '@shipfair/engine';
import { isCoarsePointer } from '../lib/device.ts';
import { useWorldStore } from '../state/world-store.ts';

interface PromptPillProps {
  engine: Engine;
}

/** "E · Visit Booth Name" (or "Tap" on touch) while a booth is in focus. It is also a button. */
export function PromptPill({ engine }: PromptPillProps) {
  const booth = useWorldStore((s) =>
    s.focusedBoothId ? s.boothsById.get(s.focusedBoothId) : undefined,
  );
  if (!booth) return null;
  const key = isCoarsePointer() ? 'Tap' : 'E';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center sm:bottom-10">
      <button
        type="button"
        data-testid="prompt-pill"
        onClick={() => engine.press('interact')}
        className="pointer-events-auto flex max-w-[90vw] items-center gap-2 rounded-full bg-ink/85 px-4 py-2 font-semibold shadow-lg backdrop-blur"
      >
        <kbd className="rounded bg-accent px-1.5 text-ink text-sm">{key}</kbd>
        <span className="truncate">Visit {booth.name}</span>
      </button>
    </div>
  );
}
