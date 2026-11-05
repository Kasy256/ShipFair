import type { AvatarPreview, BoothPreview, ShipfairTestApi } from '@shipfair/engine';
import type { AnalyticsEvent } from './lib/analytics.ts';

declare global {
  interface Window {
    /** In-page test API, installed in non-production builds only (prompt 04). */
    __shipfair?: ShipfairTestApi;
    /** Product events tracked so far, in non-production builds only (e2e checks them). */
    __shipfairEvents?: AnalyticsEvent[];
    /** The open avatar editor preview, in non-production builds only (prompt 07 e2e). */
    __shipfairPreview?: AvatarPreview;
    /** The /submit form's booth preview, in non-production builds only (prompt 08 e2e). */
    __shipfairBoothPreview?: BoothPreview;
    /** Test-only sign-in with the local email + password provider (non-production builds). */
    __shipfairAuth?: {
      signInWithPassword(email: string, password: string): Promise<string | null>;
    };
    /** Errors caught by index.html's inline handler before Sentry loaded (at most 20). */
    __sfBootErrors?: unknown[];
    /** Removes that inline handler once Sentry has its own. */
    __sfBootErrorsOff?: () => void;
    /** Non-production builds: whether Sentry has loaded (e2e checks the lazy load). */
    __shipfairSentry?: 'loaded';
    /** Non-production builds: the PostHog client once loaded (e2e checks its config). */
    __shipfairPosthog?: import('posthog-js/dist/module.no-external').PostHog;
  }
}
