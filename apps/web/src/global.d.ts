import type { ShipfairTestApi } from '@shipfair/engine';

declare global {
  interface Window {
    /** In-page test API, installed in non-production builds only (prompt 04). */
    __shipfair?: ShipfairTestApi;
  }
}
