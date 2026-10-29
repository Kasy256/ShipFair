import {
  type BoothChange,
  type BoothPublic,
  type BoothTier,
  type CityLayout,
  type District,
  type LayoutBooth,
  type Lot,
  layoutCity,
  type WorldSnapshot,
} from '@shipfair/shared';

export interface CityDiff {
  readonly added: string[];
  readonly removed: string[];
  /** Live booths whose data or tier changed (same lot). */
  readonly updated: string[];
  /** A district grew a street, so ground and street furniture need rebuilding. */
  readonly hasNewStreets: boolean;
}

const span = (tier: BoothTier) => (tier === 'pavilion' ? 2 : 1);

/**
 * The city as data: the snapshot plus incremental changes, laid out so that **existing booths
 * never move** (ARCHITECTURE.md §4). `layoutCity` places booths first-fit in approval order, so
 * placements only depend on the booths before them. The model keeps that prefix fixed:
 * - a new booth is ordered after every booth seen so far (its layout time is bumped if needed);
 * - a removed booth stays in the layout input as a tombstone, so its lot stays taken (empty);
 * - a tier change that would change a footprint (to or from pavilion) keeps the old footprint
 *   until the next snapshot rebuilds the city.
 * Pure (no Three.js), so it is unit tested.
 */
export class CityModel {
  readonly districts: readonly District[];
  readonly #live = new Map<string, BoothPublic>();
  /** Layout input in insertion order, tombstones included. */
  readonly #entries = new Map<string, LayoutBooth>();
  readonly #slugs = new Map<string, string>();
  #lastMs = Number.NEGATIVE_INFINITY;
  #layout: CityLayout;

  constructor(snapshot: WorldSnapshot) {
    this.districts = snapshot.districts;
    for (const booth of snapshot.booths) {
      if (this.#live.has(booth.id)) continue;
      this.#live.set(booth.id, booth);
      this.#slugs.set(booth.slug, booth.id);
      this.#entries.set(booth.id, toLayout(booth, booth.approvedAt));
      this.#lastMs = Math.max(this.#lastMs, Date.parse(booth.approvedAt) || 0);
    }
    this.#layout = layoutCity(this.districts, [...this.#entries.values()]);
  }

  get layout(): CityLayout {
    return this.#layout;
  }

  get liveCount(): number {
    return this.#live.size;
  }

  /** Live (not removed) booths. */
  get booths(): IterableIterator<BoothPublic> {
    return this.#live.values();
  }

  booth(id: string): BoothPublic | undefined {
    return this.#live.get(id);
  }

  isLive(id: string): boolean {
    return this.#live.has(id);
  }

  bySlug(slug: string): BoothPublic | undefined {
    const id = this.#slugs.get(slug);
    return id === undefined ? undefined : this.#live.get(id);
  }

  /** The tier a booth is drawn at: its layout tier (pinned while its footprint can't change). */
  tierOf(id: string): BoothTier | undefined {
    return this.#entries.get(id)?.tier;
  }

  /** The newest live booths by approval time, newest first. */
  latest(n: number): BoothPublic[] {
    return [...this.#live.values()]
      .sort((a, b) => Date.parse(b.approvedAt) - Date.parse(a.approvedAt) || (a.id < b.id ? 1 : -1))
      .slice(0, n);
  }

  apply(changes: readonly BoothChange[]): CityDiff {
    const diff: CityDiff = { added: [], removed: [], updated: [], hasNewStreets: false };
    for (const change of changes) {
      if (change.type === 'remove') {
        const booth = this.#live.get(change.boothId);
        if (!booth) continue;
        this.#live.delete(change.boothId);
        if (this.#slugs.get(booth.slug) === booth.id) this.#slugs.delete(booth.slug);
        diff.removed.push(change.boothId);
        continue;
      }
      const booth = change.booth;
      const old = this.#live.get(booth.id);
      const entry = this.#entries.get(booth.id);
      if (old) this.#slugs.delete(old.slug);
      this.#live.set(booth.id, booth);
      this.#slugs.set(booth.slug, booth.id);
      if (entry) {
        // Known id (live or a tombstone coming back): same lot, tier only if the footprint fits.
        const tier = span(booth.tier) === span(entry.tier) ? booth.tier : entry.tier;
        this.#entries.set(booth.id, { ...entry, tier });
        (old ? diff.updated : diff.added).push(booth.id);
        continue;
      }
      const ms = Math.max(Date.parse(booth.approvedAt) || 0, this.#lastMs + 1);
      this.#lastMs = ms;
      this.#entries.set(booth.id, toLayout(booth, new Date(ms).toISOString()));
      diff.added.push(booth.id);
    }
    if (diff.added.length + diff.updated.length + diff.removed.length === 0) return diff;
    const before = this.#layout;
    this.#layout = layoutCity(this.districts, [...this.#entries.values()]);
    const streets = (layout: CityLayout) => layout.districts.map((d) => d.streetCount).join();
    return { ...diff, hasNewStreets: streets(before) !== streets(this.#layout) };
  }

  /** The lot a booth occupies (live or tombstone), or undefined if unplaced. */
  lotOf(id: string): { readonly lot: Lot; readonly districtId: number } | undefined {
    for (const district of this.#layout.districts) {
      for (const lot of district.lots) {
        if (lot.boothId === id) return { lot, districtId: district.id };
      }
    }
    return undefined;
  }
}

function toLayout(booth: BoothPublic, approvedAt: string): LayoutBooth {
  return { id: booth.id, districtId: booth.districtId, approvedAt, tier: booth.tier };
}
