import type { ShipfairTestApi } from '@shipfair/engine';

declare global {
  interface Window {
    /** Installed by the web shell in non-production builds (prompt 04). */
    __shipfair?: ShipfairTestApi;
    /** Product events the shell tracked, non-production builds only (prompt 06). */
    __shipfairEvents?: { name: string; props: Record<string, unknown> }[];
  }
}
