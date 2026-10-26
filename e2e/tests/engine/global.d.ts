import type { ShipfairTestApi } from '@shipfair/engine';

declare global {
  interface Window {
    /** Installed by the web shell in non-production builds (prompt 04). */
    __shipfair?: ShipfairTestApi;
  }
}
