import { scrubBreadcrumb, scrubEvent, sentryDataCollection } from '@shipfair/shared';

// Browser error reporting (prompt 15). Sentry's SDK is ~25 KB gzip, so it isn't in the first
// load: it is imported after the first interaction (or after IDLE_LOAD_MS without one). Errors
// from before that are queued by the inline script in index.html and sent once it has loaded.
// Release = the git sha the build was made from (VITE_RELEASE, set by CI).

const INTERACTIONS = ['pointerdown', 'keydown', 'touchstart'] as const;
/** A visitor who never interacts (a broken boot, say) still reports, a little later. */
export const IDLE_LOAD_MS = 15_000;

type SentryModule = typeof import('@sentry/react');
let loading: Promise<SentryModule | null> | null = null;

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
export function loadSentry(config = readConfig()): Promise<SentryModule | null> {
  if (!config.dsn) return Promise.resolve(null);
  loading ??= import('@sentry/react').then(
    (Sentry) => {
      Sentry.init({
        dsn: config.dsn,
        release: config.release,
        environment: config.environment,
        // Errors only: no tracing, no replays, no cookies/headers/bodies/user fields.
        tracesSampleRate: 0,
        dataCollection: sentryDataCollection(),
        beforeSend: (event) => scrubEvent(event),
        beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
      });
      window.__sfBootErrorsOff?.();
      for (const error of window.__sfBootErrors?.splice(0) ?? []) {
        Sentry.captureException(error, { tags: { phase: 'boot' } });
      }
      if (import.meta.env.MODE !== 'production') window.__shipfairSentry = 'loaded';
      return Sentry;
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
  void loadSentry().then((Sentry) => Sentry?.captureException(error));
}
