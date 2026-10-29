import type { ShipfairTestApi } from '@shipfair/engine';
import type { AnalyticsEvent } from './lib/analytics.ts';

declare global {
  interface Window {
    /** In-page test API, installed in non-production builds only (prompt 04). */
    __shipfair?: ShipfairTestApi;
    /** Product events tracked so far, in non-production builds only (e2e checks them). */
    __shipfairEvents?: AnalyticsEvent[];
  }
}
