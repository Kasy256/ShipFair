import type RAPIER from '@dimforge/rapier3d-compat';
import {
  type BoothChange,
  type CityLayout,
  type EventBus,
  type QualityTier,
  spawnForBooth,
  spawnForDistrict,
  type Teleport,
  type WorldSnapshot,
} from '@shipfair/shared';
import { Group, type Mesh, type Vector3 } from 'three';
import type { Art } from '../art.ts';
import { BoothLayer } from '../booths/booth-layer.ts';
import { BoothInteraction } from '../booths/interaction.ts';
import { bitmapSource, type ImageSource } from '../booths/texture-cache.ts';
import { DRAW_DISTANCE_M, LOD_REEVALUATE_S } from '../config.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import {
  addWorldColliders,
  buildGates,
  CityGround,
  createStaticMaterials,
  type StaticMaterials,
} from './build-city.ts';
import { type CityDiff, CityModel } from './city-model.ts';
import type { Environment } from './environment.ts';
import { Greenery } from './greenery.ts';
import { LabelAtlas } from './labels.ts';
import { buildPlaza, type Plaza } from './plaza.ts';
import { StaticMerger } from './static-merge.ts';
import { DEFAULT_THEME, themeFor } from './themes.ts';

const JUST_LAUNCHED_COUNT = 6;

export interface CityOptions {
  readonly snapshot: WorldSnapshot;
  readonly physics: PhysicsWorld;
  readonly bus: EventBus;
  readonly environment: Environment;
  /** The camera position: draw distance is measured from it. */
  readonly viewer: Vector3;
  /** The player's feet: focus, zones and content streaming are measured from them. */
  readonly player: Vector3;
  readonly tier: QualityTier;
  /** Media host for booth images (VITE_MEDIA_HOST); null loads none. */
  readonly mediaHost: string | null;
  /** Image loader (tests inject one); defaults to ImageBitmapLoader. */
  readonly load?: ImageSource;
}

/**
 * The city built from a WorldSnapshot (prompt 05): ground, streets, gates, plaza and greenery
 * at once; booths (shells, signs, content, furniture) once the art arrives. `apply` adds,
 * changes and removes booths incrementally; existing booths never move.
 */
export class City {
  readonly root = new Group();
  readonly model: CityModel;
  readonly interaction: BoothInteraction;
  readonly plaza: Plaza;
  readonly greenery: Greenery;
  booths: BoothLayer | null = null;
  readonly #opts: CityOptions;
  readonly #ground = new CityGround();
  readonly #labels: LabelAtlas;
  readonly #materials: StaticMaterials;
  readonly #static: Mesh[];
  readonly #colliders: RAPIER.Collider[];
  #tier: QualityTier;
  #isReducedMotion = false;
  #sinceCull = Number.POSITIVE_INFINITY;

  constructor(opts: CityOptions) {
    this.#opts = opts;
    this.#tier = opts.tier;
    this.root.name = 'city';
    const model = new CityModel(opts.snapshot);
    this.model = model;
    const layout = model.layout;
    this.#ground.rebuild(layout);

    const districts = new Map(model.districts.map((d) => [d.id, d]));
    const labelIndex = new Map(model.districts.map((d, i) => [d.id, i]));
    this.#labels = new LabelAtlas([
      ...model.districts.map((d) => {
        const s = themeFor(d.theme).signage;
        return {
          text: d.name,
          board: s.board,
          ink: s.ink,
          strip: Number.parseInt(d.color.slice(1), 16),
        };
      }),
      { text: 'Claim a booth', board: 0x14161f, ink: 0xffffff, strip: 0xff6b3d },
    ]);
    this.#materials = createStaticMaterials(this.#labels);
    const merger = new StaticMerger();
    merger.castShadow(this.#materials.glow, false);
    merger.castShadow(this.#materials.labels, false);
    const physics = opts.physics;
    this.#colliders = [
      ...addWorldColliders(physics, layout),
      ...buildGates(merger, this.#materials, layout, districts, this.#labels, labelIndex, physics),
    ];
    this.plaza = buildPlaza(
      this.root,
      merger,
      this.#materials,
      layout,
      { atlas: this.#labels, districts: labelIndex, kiosk: model.districts.length },
      physics,
    );
    this.#static = merger.build(this.root, 'city-static');
    this.greenery = new Greenery(layout, physics);
    this.root.add(this.#ground.root, this.greenery.root);
    this.plaza.wall.show(model.latest(JUST_LAUNCHED_COUNT).map((b) => b.name));

    this.interaction = new BoothInteraction(opts.bus, {
      get layout() {
        return model.layout;
      },
      isLive: (id) => model.isLive(id),
      kiosk: this.plaza.kiosk,
    });
    this.interaction.onZone = (id) => {
      const district = id === null ? undefined : districts.get(id);
      opts.environment.setTheme(district ? themeFor(district.theme) : DEFAULT_THEME);
    };
  }

  get layout(): CityLayout {
    return this.model.layout;
  }

  get spawn(): { x: number; z: number; yaw: number } {
    return this.plaza.spawn;
  }

  /** Estimated GPU bytes of booth textures. */
  get textureBytes(): number {
    return this.booths?.textureBytes ?? 0;
  }

  /** Builds the booth layer from loaded art (once). */
  attachArt(art: Art): void {
    if (this.booths) return;
    this.booths = new BoothLayer({
      art,
      model: this.model,
      physics: this.#opts.physics,
      tier: this.#tier,
      mediaHost: this.#opts.mediaHost,
      load: this.#opts.load ?? bitmapSource(),
    });
    this.booths.isReducedMotion = this.#isReducedMotion;
    this.root.add(this.booths.root);
    this.#sinceCull = Number.POSITIVE_INFINITY;
  }

  /** Reduced motion turns off the booth build-up animation. */
  setReducedMotion(isReduced: boolean): void {
    this.#isReducedMotion = isReduced;
    if (this.booths) this.booths.isReducedMotion = isReduced;
  }

  apply(changes: readonly BoothChange[]): CityDiff {
    const diff = this.model.apply(changes);
    const booths = this.booths;
    if (booths) {
      for (const id of diff.removed) booths.removed(id);
      for (const id of diff.updated) booths.updated(id);
      for (const id of diff.added) booths.added(id);
    }
    if (diff.hasNewStreets) {
      this.#ground.rebuild(this.model.layout);
      this.greenery.prune(this.model.layout);
      booths?.rebuildProps();
    }
    if (diff.added.length + diff.removed.length + diff.updated.length > 0) {
      this.plaza.wall.show(this.model.latest(JUST_LAUNCHED_COUNT).map((b) => b.name));
      this.#sinceCull = Number.POSITIVE_INFINITY;
    }
    return diff;
  }

  /** Where a teleport lands, or null for an unknown slug. */
  spawnFor(to: Teleport): { x: number; z: number; yaw: number } | null {
    if (to.kind === 'booth') {
      const booth = this.model.bySlug(to.slug);
      return booth ? spawnForBooth(this.model.layout, booth.id) : null;
    }
    const district = this.model.districts.find((d) => d.slug === to.slug);
    const laid = district && this.model.layout.districts.find((d) => d.id === district.id);
    return laid ? spawnForDistrict(laid) : null;
  }

  setTier(tier: QualityTier): void {
    this.#tier = tier;
    this.booths?.setTier(tier);
    this.#sinceCull = Number.POSITIVE_INFINITY;
  }

  /** Called on the player's interact action. */
  interact(): 'booth' | 'kiosk' | null {
    return this.interaction.interact();
  }

  update(dt: number): void {
    const p = this.#opts.player;
    this.interaction.update(p.x, p.z);
    this.booths?.update(dt, p.x, p.z);
    this.#sinceCull += dt;
    if (this.#sinceCull >= LOD_REEVALUATE_S) {
      this.#sinceCull = 0;
      const v = this.#opts.viewer;
      const radius = DRAW_DISTANCE_M[this.#tier];
      this.booths?.cull(v.x, v.z, radius);
      this.greenery.cull(v.x, v.z, radius);
    }
  }

  dispose(): void {
    this.interaction.reset();
    this.booths?.dispose();
    this.booths = null;
    this.greenery.dispose();
    this.plaza.dispose();
    for (const mesh of this.#static) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    const m = this.#materials;
    m.solid.dispose();
    m.glow.dispose();
    m.labels.dispose();
    this.#labels.dispose();
    this.#ground.dispose();
    const physics = this.#opts.physics;
    if (physics.isAlive) {
      for (const c of [...this.#colliders, ...this.plaza.colliders]) {
        physics.world.removeCollider(c, false);
      }
    }
    this.root.removeFromParent();
  }
}
