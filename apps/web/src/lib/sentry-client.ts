import {
  BrowserClient,
  breadcrumbsIntegration,
  browserApiErrorsIntegration,
  captureException,
  dedupeIntegration,
  defaultStackParser,
  getCurrentScope,
  globalHandlersIntegration,
  linkedErrorsIntegration,
  makeFetchTransport,
} from '@sentry/react';
import { scrubBreadcrumb, scrubEvent, sentryDataCollection } from '@shipfair/shared';

// The browser Sentry client, loaded lazily by error-reporting.ts. Named imports and an explicit
// client (Sentry's "tree shaking" setup) instead of `init()`, which pulls in every default
// integration: errors and breadcrumbs only, no tracing, replay or feedback.

export interface SentryClientConfig {
  dsn: string;
  release: string | undefined;
  environment: string;
}

export function startSentry(config: SentryClientConfig): typeof captureException {
  const client = new BrowserClient({
    dsn: config.dsn,
    release: config.release,
    environment: config.environment,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [
      breadcrumbsIntegration(),
      browserApiErrorsIntegration(),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
    ],
    tracesSampleRate: 0,
    dataCollection: sentryDataCollection(),
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
  getCurrentScope().setClient(client);
  client.init();
  return captureException;
}
