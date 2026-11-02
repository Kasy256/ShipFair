import { DISTRICT_STAMP_DWELL_S, type PassportEvidence } from '@shipfair/shared';

// Passport evidence (prompt 13, ARCHITECTURE.md §7 "Passport trust model"). Stamps are only ever
// awarded from what a shard saw: a district dwelled in for DISTRICT_STAMP_DWELL_S, a booth visited
// (the visit rule), a maker met, a chat sent, a shard shared with someone. The shard records each
// fact once and sends them with its stats batch; the web Worker turns them into stamps.

export type EvidenceKind = PassportEvidence['kind'];

export interface EvidenceSink {
  add(player: string, kind: EvidenceKind, key: string): void;
}

interface Dwell {
  slug: string | null;
  seconds: number;
  isCounted: boolean;
}

/**
 * Continuous time inside one district per player. Leaving (or crossing into another district)
 * restarts the timer. In memory: losing it to an eviction only restarts a 10-second timer.
 */
export class DistrictDwell {
  readonly #dwell = new Map<number, Dwell>();

  /** `slug` is the district the player stands in, or null on the plaza and streets outside. */
  update(
    id: number,
    playerKey: string,
    slug: string | null,
    dtS: number,
    sink: EvidenceSink,
  ): void {
    let dwell = this.#dwell.get(id);
    if (!dwell) {
      dwell = { slug: null, seconds: 0, isCounted: false };
      this.#dwell.set(id, dwell);
    }
    if (dwell.slug !== slug) {
      dwell.slug = slug;
      dwell.seconds = 0;
      dwell.isCounted = false;
      return;
    }
    if (slug === null || dwell.isCounted) return;
    dwell.seconds += dtS;
    if (dwell.seconds >= DISTRICT_STAMP_DWELL_S) {
      dwell.isCounted = true;
      sink.add(playerKey, 'district', slug);
    }
  }

  forget(id: number): void {
    this.#dwell.delete(id);
  }
}
