import { CHAT_MAX_CHARS } from '@shipfair/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useChatStore } from '../state/chat-store.ts';
import { engineBus } from '../state/engine-bus.ts';
import { useSessionStore } from '../state/session-store.ts';
import { useUiStore } from '../state/ui-store.ts';
import { useInputLock } from '../state/use-input-lock.ts';
import { useWorldStore } from '../state/world-store.ts';
import { countdownText } from './errors.ts';

/** Lines older than this fade back while the composer is closed. */
const FADE_AFTER_MS = 20_000;

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Re-renders every second while `isTicking` (fading lines, the mute countdown). */
function useNow(isTicking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isTicking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isTicking]);
  return now;
}

/**
 * Proximity chat (prompt 12), bottom left: the last 30 lines heard within 15 m, and the composer
 * (Enter or the Chat button opens it; Enter sends, Esc closes). The log is a polite live region;
 * the bubbles in the world are decorative. Text is only ever rendered as text: links arrive
 * de-linked from the server and are never made clickable here.
 */
export function ChatPanel() {
  const lines = useChatStore((s) => s.lines);
  const mutedUntil = useChatStore((s) => s.mutedUntil);
  const isComposing = useChatStore((s) => s.isComposing);
  const setComposing = useChatStore((s) => s.setComposing);
  const isGuest = useSessionStore((s) => s.status !== 'signed-in');
  const isOnline = useWorldStore((s) => s.netStatus === 'online');
  const openSignIn = useUiStore((s) => s.openSignIn);
  const location = useLocation();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const now = useNow(mutedUntil > Date.now() || lines.length > 0);
  const isMuted = mutedUntil > now;
  useInputLock(isComposing);

  useEffect(() => {
    if (isComposing) inputRef.current?.focus();
  }, [isComposing]);

  const close = () => {
    setComposing(false);
    setText('');
  };
  const send = (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (message !== '') engineBus.emit('chat:send', { text: message });
    close();
  };

  const placeholder = isGuest
    ? 'Sign in to chat'
    : isMuted
      ? `Muted · ${countdownText(mutedUntil, now)}`
      : isOnline
        ? 'Say something to people nearby'
        : 'Chat opens when you are connected';
  const canType = !isGuest && !isMuted && isOnline;

  return (
    <section
      aria-label="Nearby chat"
      className="pointer-events-none absolute bottom-24 left-3 z-10 w-[min(80vw,21rem)] sm:bottom-3"
    >
      <ol
        role="log"
        aria-live="polite"
        aria-label="Chat messages from people nearby"
        className="mb-2 grid max-h-48 gap-0.5 overflow-y-auto text-sm"
        data-testid="chat-log"
      >
        {lines.map((line) => (
          <li
            key={line.key}
            data-testid="chat-line"
            className={`w-fit max-w-full break-words rounded-lg bg-ink/70 px-2 py-0.5 backdrop-blur transition-opacity duration-700 ${
              !isComposing && now - line.ts > FADE_AFTER_MS ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <time className="mr-1.5 text-muted text-xs" dateTime={new Date(line.ts).toISOString()}>
              {timeOf(line.ts)}
            </time>
            <span className={`font-semibold ${line.isYou ? 'text-accent' : ''}`}>{line.name}</span>
            <span className="text-muted">: </span>
            {line.text}
          </li>
        ))}
      </ol>
      {isComposing ? (
        <form onSubmit={send} className="pointer-events-auto flex gap-2">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            onBlur={() => {
              if (text.trim() === '') close();
            }}
            maxLength={CHAT_MAX_CHARS}
            disabled={!canType}
            placeholder={placeholder}
            aria-label="Chat message"
            data-testid="chat-input"
            className="min-w-0 flex-1 rounded-lg border border-paper/20 bg-ink/85 px-3 py-2 text-sm backdrop-blur disabled:opacity-70"
          />
          <button
            type="submit"
            disabled={!canType}
            className="rounded-lg bg-accent px-3 py-2 font-bold text-ink text-sm disabled:opacity-60"
          >
            Send
          </button>
        </form>
      ) : isGuest ? (
        <div className="pointer-events-auto flex gap-2">
          <input
            disabled
            placeholder={placeholder}
            aria-label="Chat message"
            data-testid="chat-input"
            className="min-w-0 flex-1 rounded-lg border border-paper/20 bg-ink/70 px-3 py-2 text-sm opacity-70"
          />
          <button
            type="button"
            onClick={() => openSignIn(location.pathname)}
            className="rounded-lg bg-ink/80 px-3 py-2 font-semibold text-sm backdrop-blur hover:bg-ink"
          >
            Sign in
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setComposing(true)}
          data-testid="chat-open"
          className="pointer-events-auto rounded-lg bg-ink/75 px-3 py-1.5 font-semibold text-sm backdrop-blur hover:bg-ink"
        >
          {isMuted ? `Muted · ${countdownText(mutedUntil, now)}` : 'Chat'}{' '}
          <kbd className="ml-1 text-muted text-xs">Enter</kbd>
        </button>
      )}
    </section>
  );
}
