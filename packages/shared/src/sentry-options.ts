import { scrubBreadcrumb, scrubEvent } from './scrub.ts';

// Sentry options shared by both Workers (`withSentry`, `instrumentDurableObjectWithSentry`).
// Typed structurally so `packages/shared` doesn't depend on a Sentry SDK.

/**
 * Sentry 11's `dataCollection`: its defaults attach cookies, headers, bodies, query strings and
 * user fields. We send none of them (no chat text, no emails, no tokens); `scrubEvent` is the
 * second net. Used by the browser too.
 */
export function sentryDataCollection() {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [] as never[],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
  };
}

export interface WorkerSentryEnv {
  SENTRY_DSN?: string | undefined;
  RELEASE?: string | undefined;
  ENVIRONMENT: string;
}

/**
 * Options for `@sentry/cloudflare`. Without a DSN (development, tests) Sentry is disabled. No
 * tracing, no request data (sentryDataCollection), and every event goes through `scrubEvent`.
 */
export function workerSentryOptions(env: WorkerSentryEnv) {
  return {
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
    release: env.RELEASE,
    environment: env.ENVIRONMENT,
    tracesSampleRate: 0,
    dataCollection: sentryDataCollection(),
    beforeSend: <T extends object>(event: T): T => scrubEvent(event),
    beforeBreadcrumb: <T extends { category?: string }>(crumb: T): T | null =>
      scrubBreadcrumb(crumb),
  };
}
