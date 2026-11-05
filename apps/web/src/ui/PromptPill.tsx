import type { Engine } from '@shipfair/engine';
import { hapticTick, isCoarsePointer } from '../lib/device.ts';
import { useWorldStore } from '../state/world-store.ts';

interface PromptPillProps {
  engine: Engine;
}

/**
 * "E · Visit Booth Name" (or "Tap" on touch) while a booth is in focus, "E · See what just
 * launched" at the plaza wall, "E · Claim a booth" at the kiosk. It is also a button.
 */
export function PromptPill({ engine }: PromptPillProps) {
  const booth = useWorldStore((s) =>
    s.focusedBoothId ? s.boothsById.get(s.focusedBoothId) : undefined,
  );
  const isAtWall = useWorldStore((s) => s.isAtWall);
  const isAtKiosk = useWorldStore((s) => s.isAtKiosk);
  const label = booth
    ? `Visit ${booth.name}`
    : isAtKiosk
      ? 'Claim a booth'
      : isAtWall
        ? 'See what just launched'
        : null;
  if (!label) return null;
  const key = isCoarsePointer() ? 'Tap' : 'E';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--safe-bottom)+7.5rem)] z-10 flex justify-center sm:bottom-10">
      <button
        type="button"
        data-testid="prompt-pill"
        onClick={() => {
          hapticTick();
          engine.press('interact');
        }}
        className="pointer-events-auto flex max-w-[90vw] items-center gap-2 rounded-full bg-ink/85 px-4 py-2 font-semibold shadow-lg backdrop-blur"
      >
        <kbd className="rounded bg-accent px-1.5 text-ink text-sm">{key}</kbd>
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}
