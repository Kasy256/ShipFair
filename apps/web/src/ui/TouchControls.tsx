import type { Engine, JoystickView } from '@shipfair/engine';
import { useEffect, useRef } from 'react';
import { isCoarsePointer } from '../lib/device.ts';

interface TouchControlsProps {
  engine: Engine;
}

/**
 * On-screen controls for touch screens: the floating joystick's ring and knob (the engine reads
 * the finger; this only draws it) plus jump and interact buttons. The joystick is positioned
 * through refs, so moving a finger never re-renders React.
 */
export function TouchControls({ engine }: TouchControlsProps) {
  const ringRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const draw = (view: Readonly<JoystickView>) => {
      const ring = ringRef.current;
      const knob = knobRef.current;
      if (!ring || !knob) return;
      ring.style.display = view.isActive ? 'block' : 'none';
      knob.style.display = view.isActive ? 'block' : 'none';
      const size = view.radius * 2;
      ring.style.width = `${size}px`;
      ring.style.height = `${size}px`;
      ring.style.transform = `translate(${view.baseX - view.radius}px, ${view.baseY - view.radius}px)`;
      knob.style.transform = `translate(${view.knobX - 24}px, ${view.knobY - 24}px)`;
    };
    engine.onJoystick(draw);
    return () => engine.onJoystick(undefined);
  }, [engine]);

  if (!isCoarsePointer()) return null;

  // pointerdown, not click: a thumb resting on the stick must not delay the jump.
  const button =
    'pointer-events-auto flex h-16 w-16 select-none items-center justify-center rounded-full ' +
    'bg-paper/25 font-semibold text-paper backdrop-blur focus-visible:outline-2 ' +
    'focus-visible:outline-accent active:bg-paper/45';
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="touch-controls">
      <div
        ref={ringRef}
        className="absolute top-0 left-0 hidden rounded-full border-2 border-paper/50 bg-paper/10"
      />
      <div
        ref={knobRef}
        data-testid="joystick-knob"
        className="absolute top-0 left-0 hidden h-12 w-12 rounded-full bg-paper/60"
      />
      <div className="absolute right-6 bottom-8 flex flex-col items-end gap-4">
        <button
          type="button"
          className={button}
          onPointerDown={() => engine.press('interact')}
          onClick={(e) => e.detail === 0 && engine.press('interact')}
        >
          Use
        </button>
        <button
          type="button"
          className={`${button} h-20 w-20`}
          onPointerDown={() => engine.press('jump')}
          onClick={(e) => e.detail === 0 && engine.press('jump')}
        >
          Jump
        </button>
      </div>
    </div>
  );
}
