import { useEffect, useRef } from 'react';
import { useInputLock } from '../state/use-input-lock.ts';

interface ControlsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ROWS: readonly (readonly [string, string])[] = [
  ['Move', 'W A S D or arrow keys · left thumb on touch'],
  ['Run', 'Hold Shift · push the stick to its edge'],
  ['Jump', 'Space · Jump button · A on a gamepad'],
  ['Look', 'Click the world, then move the mouse (Esc to free it) · drag · right thumb'],
  ['Zoom', 'Mouse wheel'],
  ['Wave', 'F'],
  ['Interact', 'E · Use button'],
];

/**
 * The first real panel: a modal list of controls. While it is open the engine's input is off,
 * so keys pressed here never move the avatar. A native <dialog> traps focus and closes on Esc.
 */
export function ControlsPanel({ isOpen, onClose }: ControlsPanelProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useInputLock(isOpen);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="controls-title"
      className="m-auto w-[min(92vw,28rem)] rounded-xl bg-ink p-5 text-paper backdrop:bg-ink/60"
    >
      <h2 id="controls-title" className="mb-3 font-bold text-xl">
        Controls
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {ROWS.map(([action, how]) => (
          <div key={action} className="contents">
            <dt className="font-semibold text-accent">{action}</dt>
            <dd>{how}</dd>
          </div>
        ))}
      </dl>
      <label className="mt-4 block text-sm">
        <span className="mb-1 block opacity-80">Try typing here: the avatar stays put.</span>
        <input
          type="text"
          className="w-full rounded border border-paper/30 bg-transparent px-2 py-1"
          placeholder="wasd"
        />
      </label>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 rounded bg-accent px-4 py-2 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-paper"
      >
        Close controls
      </button>
    </dialog>
  );
}
