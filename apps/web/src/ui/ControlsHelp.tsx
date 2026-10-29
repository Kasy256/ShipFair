import { useEffect } from 'react';
import { isCoarsePointer } from '../lib/device.ts';
import { useUiStore } from '../state/ui-store.ts';

/** The help card shows on entering and hides itself after this long. */
export const HELP_AUTO_HIDE_MS = 10_000;

const KEYS: readonly (readonly [string, string])[] = [
  ['Move', 'W A S D or arrow keys'],
  ['Run', 'Hold Shift'],
  ['Jump', 'Space'],
  ['Look', 'Click the world, then move the mouse (Esc frees it)'],
  ['Zoom', 'Mouse wheel'],
  ['Visit a booth', 'E when the prompt shows'],
  ['Wave', 'F'],
  ['Map and search', 'M'],
  ['This help', '?'],
];

const TOUCH: readonly (readonly [string, string])[] = [
  ['Move', 'Left thumb (push to the edge to run)'],
  ['Look', 'Drag with your right thumb'],
  ['Jump', 'Jump button'],
  ['Visit a booth', 'Tap the prompt or the Use button'],
  ['Map and search', 'Map button'],
];

/**
 * A non-modal card of controls: it doesn't take focus or pause the world. It opens on entering,
 * hides after 10 s, and toggles with `?` or the Help button. The reduced-motion switch lives here.
 */
export function ControlsHelp() {
  const isOpen = useUiStore((s) => s.isHelpOpen);
  const setHelpOpen = useUiStore((s) => s.setHelpOpen);
  const isReducedMotion = useUiStore((s) => s.isReducedMotion);
  const setReducedMotion = useUiStore((s) => s.setReducedMotion);

  useEffect(() => {
    setHelpOpen(true);
    const timer = setTimeout(() => setHelpOpen(false), HELP_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [setHelpOpen]);

  if (!isOpen) return null;
  const rows = isCoarsePointer() ? TOUCH : KEYS;
  return (
    <aside
      id="controls-help"
      aria-labelledby="controls-help-title"
      data-testid="controls-help"
      className="absolute top-28 left-3 z-10 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl bg-ink/85 p-4 text-sm shadow-lg backdrop-blur sm:top-auto sm:bottom-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 id="controls-help-title" className="font-bold">
          Controls
        </h2>
        <button
          type="button"
          onClick={() => setHelpOpen(false)}
          className="rounded px-2 py-0.5 text-muted hover:text-paper"
        >
          Hide
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([action, how]) => (
          <div key={action} className="contents">
            <dt className="font-semibold text-accent">{action}</dt>
            <dd>{how}</dd>
          </div>
        ))}
      </dl>
      <label className="mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          checked={isReducedMotion}
          onChange={(e) => setReducedMotion(e.currentTarget.checked)}
          className="h-4 w-4 accent-accent"
        />
        Reduce motion
      </label>
    </aside>
  );
}
