import { BOOTH_VISIT_MIN_S } from '@shipfair/shared';

// Booth dwell tracking (ARCHITECTURE.md §7 "Visit tracking"). A player standing within
// BOOTH_VISIT_RADIUS_M of the same booth for BOOTH_VISIT_MIN_S seconds makes one visit; walking
// away and coming back makes another. Dwell time is transient: losing it to an eviction only
// restarts a 5-second timer, so it lives in memory.

export interface VisitSink {
  /** One completed visit; the sink decides whether it is the player's first today. */
  record(day: string, playerKey: string, boothId: string): void;
}

interface Dwell {
  boothId: string | null;
  seconds: number;
  isCounted: boolean;
}

/** UTC calendar day for an epoch-ms time, e.g. `2026-10-31`. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export class VisitTracker {
  readonly #dwell = new Map<number, Dwell>();

  /**
   * Advances one player's dwell by `dtS` seconds. `boothId` is the nearest booth within the visit
   * radius (shared `nearestBooth`), or null.
   */
  update(
    id: number,
    playerKey: string,
    boothId: string | null,
    dtS: number,
    day: string,
    sink: VisitSink,
  ): void {
    let dwell = this.#dwell.get(id);
    if (!dwell) {
      dwell = { boothId: null, seconds: 0, isCounted: false };
      this.#dwell.set(id, dwell);
    }
    if (dwell.boothId !== boothId) {
      dwell.boothId = boothId;
      dwell.seconds = 0;
      dwell.isCounted = false;
      return;
    }
    if (boothId === null || dwell.isCounted) return;
    dwell.seconds += dtS;
    if (dwell.seconds >= BOOTH_VISIT_MIN_S) {
      dwell.isCounted = true;
      sink.record(day, playerKey, boothId);
    }
  }

  forget(id: number): void {
    this.#dwell.delete(id);
  }
}
