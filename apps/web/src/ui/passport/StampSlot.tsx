import type { District, StampKey } from '@shipfair/shared';
import { stampTilt } from './passport-pages.ts';
import { stampInfo } from './stamp-info.ts';

interface StampSlotProps {
  stamp: StampKey;
  districts: readonly District[];
  isHeld: boolean;
  /** Claimed but not confirmed by the server yet. */
  isPending?: boolean;
  /** Stamp it in with the animation, after `delayMs`. */
  isFresh?: boolean;
  delayMs?: number;
}

/** One stamp on a passport page: inked when held, a dashed outline with a hint when not. */
export function StampSlot({
  stamp,
  districts,
  isHeld,
  isPending = false,
  isFresh = false,
  delayMs = 0,
}: StampSlotProps) {
  const info = stampInfo(stamp, districts);
  const tilt = stampTilt(stamp);
  return (
    <li className="flex flex-col items-center text-center" data-stamp={stamp} data-held={isHeld}>
      {isHeld ? (
        <span
          aria-hidden="true"
          className={`grid h-16 w-16 place-items-center rounded-full border-4 border-double font-black text-2xl ${isFresh ? 'animate-stamp-in' : ''}`}
          style={{
            color: info.color,
            borderColor: info.color,
            background: `${info.color}22`,
            transform: `rotate(${tilt}deg)`,
            ['--stamp-tilt' as string]: `${tilt}deg`,
            animationDelay: `${delayMs}ms`,
          }}
        >
          {info.glyph}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="grid h-16 w-16 place-items-center rounded-full border-2 border-paper/20 border-dashed text-paper/25 text-xl"
        >
          ?
        </span>
      )}
      <span className={`mt-1.5 font-semibold text-sm ${isHeld ? '' : 'text-muted'}`}>
        {info.title}
        <span className="sr-only">{isHeld ? ' (stamped)' : ' (not yet)'}</span>
      </span>
      <span className="text-muted text-xs leading-tight">
        {isPending ? 'Checking…' : info.detail}
      </span>
    </li>
  );
}
