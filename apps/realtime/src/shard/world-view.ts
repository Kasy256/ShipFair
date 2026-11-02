import {
  BOOTHS_PER_USER_MAX,
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
const NO_BOOTHS: readonly string[] = [];
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
  readonly #boothsByOwner = new Map<string, string[]>();
  readonly #ownerByBooth = new Map<string, string>();
  readonly #slugByDistrict = new Map<number, string>();

  private constructor(version: number, layout: CityLayout | null, snapshot?: WorldSnapshot) {
    this.version = version;
    this.layout = layout;
    this.bounds = layout?.bounds ?? FALLBACK_BOUNDS;
    this.#boothBySlug = new Map(snapshot?.booths.map((b) => [b.slug, b.id]) ?? []);
    for (const booth of snapshot?.booths ?? []) {
      this.#ownerByBooth.set(booth.id, booth.ownerId);
      const owned = this.#boothsByOwner.get(booth.ownerId);
      if (!owned) this.#boothsByOwner.set(booth.ownerId, [booth.id]);
      else if (owned.length < BOOTHS_PER_USER_MAX) owned.push(booth.id);
    }
    const laid = new Map(layout?.districts.map((d) => [d.id, d]) ?? []);
    this.#districtBySlug = new Map();
    for (const d of snapshot?.districts ?? []) {
      this.#slugByDistrict.set(d.id, d.slug);
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

  /** Live booths owned by this profile (the snapshot holds approved booths only). */
  boothsOf(uid: string | undefined): readonly string[] {
    return (uid && this.#boothsByOwner.get(uid)) || NO_BOOTHS;
  }

  /** The owner's profile id of a live booth (passport `met-a-maker`). */
  ownerOf(boothId: string): string | undefined {
    return this.#ownerByBooth.get(boothId);
  }

  /** A district's slug by id (passport district evidence). */
  districtSlug(id: number): string | undefined {
    return this.#slugByDistrict.get(id);
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
