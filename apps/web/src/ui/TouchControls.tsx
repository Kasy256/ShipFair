import type { Engine, JoystickView } from '@shipfair/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { hapticTick, isCoarsePointer } from '../lib/device.ts';
import { useChatStore } from '../state/chat-store.ts';
import { useSessionStore } from '../state/session-store.ts';
import { useUiStore } from '../state/ui-store.ts';
import { selectCanUse, useWorldStore } from '../state/world-store.ts';
import { EmoteMenu } from './EmoteMenu.tsx';

interface TouchControlsProps {
  engine: Engine;
}

// Thumb-sized targets (Jump is the one pressed most), inside the safe areas.
const BUTTON =
  'pointer-events-auto flex select-none items-center justify-center rounded-full bg-paper/25 ' +
  'font-semibold text-paper backdrop-blur focus-visible:outline-2 focus-visible:outline-accent ' +
  'active:bg-paper/45';

/**
 * On-screen controls for touch screens (prompt 14). Left thumb: the floating joystick (the engine
 * reads the finger on the left half; this draws it, and a faint ring at rest shows where to put
 * it). Right thumb: Jump; Use, only while something can be used (a booth in focus, the kiosk or
 * the Just Launched wall), with a short vibration where supported; Emote (the wheel) and Chat.
 * The joystick is positioned through refs, so moving a finger never re-renders React.
 */
export function TouchControls({ engine }: TouchControlsProps) {
  const ringRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  const [isEmoteOpen, setEmoteOpen] = useState(false);
  const closeEmotes = useCallback(() => setEmoteOpen(false), []);
  const canUse = useWorldStore(selectCanUse);
  const isGuest = useSessionStore((s) => s.status !== 'signed-in');
  const setComposing = useChatStore((s) => s.setComposing);
  const openSignIn = useUiStore((s) => s.openSignIn);
  const location = useLocation();

  useEffect(() => {
    const draw = (view: Readonly<JoystickView>) => {
      const ring = ringRef.current;
      const knob = knobRef.current;
      if (!ring || !knob) return;
      ring.style.display = view.isActive ? 'block' : 'none';
      knob.style.display = view.isActive ? 'block' : 'none';
      if (restRef.current) restRef.current.style.opacity = view.isActive ? '0' : '1';
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

  const use = () => {
    hapticTick();
    engine.press('interact');
  };
  const chat = () => (isGuest ? openSignIn(location.pathname) : setComposing(true));

  // pointerdown, not click: a thumb resting on the stick must not delay the jump. A keyboard or
  // switch "click" (detail 0) still works.
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="touch-controls">
      <div
        ref={restRef}
        aria-hidden="true"
        className="absolute bottom-[calc(var(--safe-bottom)+1.5rem)] left-[calc(var(--safe-left)+1.5rem)] h-28 w-28 rounded-full border-2 border-paper/20 transition-opacity"
      />
      <div
        ref={ringRef}
        className="absolute top-0 left-0 hidden rounded-full border-2 border-paper/50 bg-paper/10"
      />
      <div
        ref={knobRef}
        data-testid="joystick-knob"
        className="absolute top-0 left-0 hidden h-12 w-12 rounded-full bg-paper/60"
      />
      {isEmoteOpen && <EmoteMenu onClose={closeEmotes} />}
      <div className="absolute right-(--safe-right) bottom-(--safe-bottom) flex items-end gap-3 p-2">
        <div className="flex flex-col gap-3">
          <button type="button" className={`${BUTTON} h-14 w-14 text-sm`} onClick={chat}>
            Chat
          </button>
          <button
            type="button"
            className={`${BUTTON} h-14 w-14 text-sm`}
            aria-haspopup="menu"
            aria-expanded={isEmoteOpen}
            onClick={() => setEmoteOpen(!isEmoteOpen)}
          >
            Emote
          </button>
        </div>
        <div className="flex flex-col items-center gap-3">
          {/* Hidden, not removed, while nothing can be used: the cluster never jumps around. */}
          <button
            type="button"
            className={`${BUTTON} h-16 w-16 ${canUse ? '' : 'invisible'}`}
            onPointerDown={use}
            onClick={(e) => e.detail === 0 && use()}
            onContextMenu={(e) => e.preventDefault()}
          >
            Use
          </button>
          <button
            type="button"
            className={`${BUTTON} h-20 w-20`}
            onPointerDown={() => engine.press('jump')}
            onClick={(e) => e.detail === 0 && engine.press('jump')}
          >
            Jump
          </button>
        </div>
      </div>
    </div>
  );
}
