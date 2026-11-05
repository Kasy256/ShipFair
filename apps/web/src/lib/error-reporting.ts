// Browser error reporting (prompt 15). The Sentry client (sentry-client.ts) isn't in the first
// load: it is imported after the first interaction (or after IDLE_LOAD_MS without one). Errors
// from before that are queued by the inline script in index.html and sent once it has loaded.
// Release = the git sha the build was made from (VITE_RELEASE, set by CI).

const INTERACTIONS = ['pointerdown', 'keydown', 'touchstart'] as const;
/** A visitor who never interacts (a broken boot, say) still reports, a little later. */
export const IDLE_LOAD_MS = 15_000;

type Capture = (error: unknown, hint?: { tags?: Record<string, string> }) => unknown;
let loading: Promise<Capture | null> | null = null;

export interface ErrorReportingConfig {
  dsn: string | undefined;
  release: string | undefined;
  environment: string;
}

export function readConfig(): ErrorReportingConfig {
  return {
    dsn: import.meta.env.VITE_SENTRY_DSN || undefined,
    release: import.meta.env.VITE_RELEASE || undefined,
    environment: import.meta.env.MODE,
  };
}

/** Imports and starts Sentry once, then hands it the errors queued during boot. */
export function loadSentry(config = readConfig()): Promise<Capture | null> {
  const { dsn } = config;
  if (!dsn) return Promise.resolve(null);
  loading ??= import('./sentry-client.ts').then(
    ({ startSentry }) => {
      const capture: Capture = startSentry({ ...config, dsn });
      window.__sfBootErrorsOff?.();
      for (const error of window.__sfBootErrors?.splice(0) ?? []) {
        capture(error, { tags: { phase: 'boot' } });
      }
      if (import.meta.env.MODE !== 'production') window.__shipfairSentry = 'loaded';
      return capture;
    },
    (error: unknown) => {
      // Offline or blocked: keep the page working, and allow a later retry.
      console.warn('Error reporting could not load', error);
      loading = null;
      return null;
    },
  );
  return loading;
}

/** Arms the lazy load. Returns a function that disarms it (tests, HMR). */
export function startErrorReporting(config = readConfig()): () => void {
  if (!config.dsn) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const load = () => {
    disarm();
    void loadSentry(config);
  };
  const disarm = () => {
    for (const type of INTERACTIONS) window.removeEventListener(type, load, true);
    if (timer !== undefined) clearTimeout(timer);
  };
  for (const type of INTERACTIONS) {
    window.addEventListener(type, load, { capture: true, once: true, passive: true });
  }
  timer = setTimeout(load, IDLE_LOAD_MS);
  return disarm;
}

/** Reports an error we handled (and showed a message for) but still want to know about. */
export function reportError(error: unknown): void {
  void loadSentry().then((capture) => capture?.(error));
}
