import type { AvatarPreview, ShipfairTestApi } from '@shipfair/engine';

declare global {
  interface Window {
    /** Installed by the web shell in non-production builds (prompt 04). */
    __shipfair?: ShipfairTestApi;
    /** Product events the shell tracked, non-production builds only (prompt 06). */
    __shipfairEvents?: { name: string; props: Record<string, unknown> }[];
    /** The open avatar editor preview (prompt 07). */
    __shipfairPreview?: AvatarPreview;
    /** Test-only email + password sign-in against local Supabase (prompt 07). */
    __shipfairAuth?: {
      signInWithPassword(email: string, password: string): Promise<string | null>;
    };
  }
}
