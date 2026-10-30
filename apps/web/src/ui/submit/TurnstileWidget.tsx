import { useEffect, useRef, useState } from 'react';
import { TURNSTILE_TEST_SITE_KEY } from './booth-form.ts';

// Cloudflare Turnstile, rendered explicitly into one element. Tokens are single use: the parent
// remounts this (new `key`) after a submit so a fresh token is fetched.

interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      theme: 'dark' | 'light' | 'auto';
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing'));
    script.onerror = () => reject(new Error('turnstile script failed'));
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** The site key, or the always-pass test key in development. Null when not configured. */
export function turnstileSiteKey(): string | null {
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  return key || (import.meta.env.DEV ? TURNSTILE_TEST_SITE_KEY : null);
}

interface TurnstileWidgetProps {
  onToken: (token: string | null) => void;
}

export function TurnstileWidget({ onToken }: TurnstileWidgetProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [failed, setFailed] = useState(false);
  const siteKey = turnstileSiteKey();

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !siteKey) return;
    let widgetId: string | null = null;
    let isCurrent = true;
    loadTurnstile()
      .then((api) => {
        if (!isCurrent) return;
        widgetId = api.render(box, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => {
            onTokenRef.current(null);
            setFailed(true);
          },
        });
      })
      .catch((error: unknown) => {
        console.error('Turnstile failed to load', error);
        if (isCurrent) setFailed(true);
      });
    return () => {
      isCurrent = false;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  if (!siteKey) {
    return <p className="text-amber-300 text-sm">The bot check isn't set up on this server.</p>;
  }
  return (
    <div>
      <div ref={boxRef} data-testid="turnstile" />
      {failed && (
        <p role="alert" className="mt-1 text-red-300 text-sm">
          The bot check couldn't load. Turn off blockers for this site or reload the page.
        </p>
      )}
    </div>
  );
}
