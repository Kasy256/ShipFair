import { useEffect, useRef } from 'react';
import { engineBus } from '../state/engine-bus.ts';

/** Emote ids in the engine's EMOTE_CLIPS order, with their button labels. */
export const EMOTES = ['Wave', 'Clap', 'Dance', 'Cheer', 'Point', 'Sit'] as const;
const RADIUS_PX = 92;

interface EmoteMenuProps {
  onClose: () => void;
}

/**
 * The touch emote wheel (long-press the Use button): six buttons on a circle around where the
 * Use button is. Picking one plays it on your avatar and sends it to everyone nearby.
 */
export function EmoteMenu({ onClose }: EmoteMenuProps) {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const play = (e: number) => {
    engineBus.emit('emote', { e });
    onClose();
  };

  return (
    <div
      role="menu"
      aria-label="Emotes"
      data-testid="emote-menu"
      className="pointer-events-auto absolute right-14 bottom-28 h-0 w-0"
    >
      {EMOTES.map((label, e) => {
        // Spread over the upper-left half circle, away from the screen edges.
        const angle = Math.PI / 2 + (e / (EMOTES.length - 1)) * (Math.PI / 2) + Math.PI / 12;
        const x = Math.cos(angle) * RADIUS_PX;
        const y = -Math.sin(angle) * RADIUS_PX;
        return (
          <button
            key={label}
            ref={e === 0 ? firstRef : undefined}
            type="button"
            role="menuitem"
            className="absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink/80 font-semibold text-paper text-xs backdrop-blur focus-visible:outline-2 focus-visible:outline-accent active:bg-accent active:text-ink"
            style={{ left: x, top: y }}
            onClick={() => play(e)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
