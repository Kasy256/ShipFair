import {
  type CityLayout,
  type DistrictLayout,
  layoutCity,
  type Rect,
  spawnForBooth,
  spawnForDistrict,
  type Teleport,
  type WorldSnapshot,
} from '@shipfair/shared';

// The city as the shard sees it: the same `layoutCity` the clients run, plus slug lookups for
// teleports. Rebuilt from `/api/world` every WORLD_REFRESH_MS or on `worldUpdate`.

/** Used until the first snapshot arrives: generous, so nobody is snapped back for it. */
const FALLBACK_BOUNDS: Rect = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };

export interface Spawn {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export class WorldView {
  readonly version: number;
  readonly layout: CityLayout | null;
  readonly bounds: Rect;
  readonly #boothBySlug: Map<string, string>;
  readonly #districtBySlug: Map<string, DistrictLayout>;

  private constructor(version: number, layout: CityLayout | null, snapshot?: WorldSnapshot) {
    this.version = version;
    this.layout = layout;
    this.bounds = layout?.bounds ?? FALLBACK_BOUNDS;
    this.#boothBySlug = new Map(snapshot?.booths.map((b) => [b.slug, b.id]) ?? []);
    const laid = new Map(layout?.districts.map((d) => [d.id, d]) ?? []);
    this.#districtBySlug = new Map();
    for (const d of snapshot?.districts ?? []) {
      const district = laid.get(d.id);
      if (district) this.#districtBySlug.set(d.slug, district);
    }
  }

  static empty(): WorldView {
    return new WorldView(-1, null);
  }

  static from(snapshot: WorldSnapshot): WorldView {
    return new WorldView(
      snapshot.version,
      layoutCity(snapshot.districts, snapshot.booths),
      snapshot,
    );
  }

  get isLoaded(): boolean {
    return this.layout !== null;
  }

  /** Where a teleport lands (same helpers as the client), or null for an unknown target. */
  teleportTarget(to: Teleport): Spawn | null {
    if (!this.layout) return null;
    if (to.kind === 'booth') {
      const id = this.#boothBySlug.get(to.slug);
      return id ? spawnForBooth(this.layout, id) : null;
    }
    const district = this.#districtBySlug.get(to.slug);
    return district ? spawnForDistrict(district) : null;
  }
}
