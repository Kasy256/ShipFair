import * as Sentry from '@sentry/cloudflare';
import { workerSentryOptions } from '@shipfair/shared';
import type { Env } from './env.ts';

// Sentry for the web Worker (`fetch`, `scheduled` and the `WebRpc` entrypoint). Off without
// `SENTRY_DSN` (development, tests). Release = the deployed git sha (`RELEASE`).

export const sentryOptions = (env: Env) => workerSentryOptions(env);

/** For errors we turn into a response ourselves (app.onError), so Sentry still sees them. */
export function reportError(error: unknown): void {
  Sentry.captureException(error);
}

export const withSentry = Sentry.withSentry;
