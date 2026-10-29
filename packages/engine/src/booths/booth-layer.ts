import type RAPIER from '@dimforge/rapier3d-compat';
import type { BoothTier, District, Lot, QualityTier } from '@shipfair/shared';
import { Color, Group, Matrix4 } from 'three';
import type { Art } from '../art.ts';
import { BUILD_UP_S } from '../config.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import type { InstanceSet } from '../render/instance-set.ts';
import type { CityModel } from '../world/city-model.ts';
import { planDistrictProps } from '../world/prop-plan.ts';
import { accentFor, type DistrictTheme, themeFor } from '../world/themes.ts';
import { type ContentAnchor, type ContentBooth, ContentStreamer } from './content.ts';
import { BoothShells } from './shells.ts';
import { SignAtlas } from './signs.ts';
import type { ImageSource } from './texture-cache.ts';

interface BoothVisual extends ContentBooth {
  readonly glow: Color;
  readonly theme: DistrictTheme;
}

const slot = new Matrix4();
const world = new Matrix4();

/**
 * Everything drawn per booth, built once the art (booth kit, props) has loaded: instanced shells,
 * name signs, streamed content and street furniture. Booths are added, changed and removed
 * incrementally; only a new street rebuilds the furniture.
 */
export class BoothLayer {
  readonly root = new Group();
  readonly shells: BoothShells;
  readonly signs = new SignAtlas();
  readonly content: ContentStreamer;
  /** Live booths' lot centres, kept in step with the model (content streaming reads it). */
  readonly anchors: ContentAnchor[] = [];
  readonly #art: Art;
  readonly #model: CityModel;
  readonly #physics: PhysicsWorld;
  readonly #districts: ReadonlyMap<number, District>;
  readonly #visuals = new Map<string, BoothVisual>();
  readonly #signColors = new Map<string, { board: Color; ink: Color }>();
  /** Booths still building up, whose signs follow the animated scale. */
  readonly #growing: string[] = [];
  #growAge = 0;
  #props: { set: InstanceSet; colliders: RAPIER.Collider[] } | null = null;

  constructor(opts: {
    art: Art;
    model: CityModel;
    physics: PhysicsWorld;
    tier: QualityTier;
    mediaHost: string | null;
    load: ImageSource;
  }) {
    this.root.name = 'booths';
    this.#art = opts.art;
    this.#model = opts.model;
    this.#physics = opts.physics;
    this.#districts = new Map(opts.model.districts.map((d) => [d.id, d]));
    const counts: Record<BoothTier, number> = { stall: 0, booth: 0, pavilion: 0 };
    for (const b of opts.model.booths) counts[opts.model.tierOf(b.id) ?? b.tier]++;
    const capacity = Math.ceil(Math.max(...Object.values(counts)) * 1.25) + 8;
    this.shells = new BoothShells(opts.art.kit, opts.physics, capacity);
    this.content = new ContentStreamer(this.shells, opts.mediaHost, opts.tier, opts.load);
    this.root.add(this.shells.root, this.signs.root, this.content.root);
    for (const district of opts.model.layout.districts) {
      for (const lot of district.lots) {
        if (lot.boothId && opts.model.isLive(lot.boothId)) this.#add(lot.boothId, lot, false);
      }
    }
    this.rebuildProps();
  }

  get boothCount(): number {
    return this.shells.count;
  }

  get propCount(): number {
    return this.#props?.colliders.length ?? 0;
  }

  /** Estimated GPU bytes of booth textures (signs, cached images, monograms). */
  get textureBytes(): number {
    return this.signs.bytes + this.content.bytes;
  }

  visual(id: string): ContentBooth | undefined {
    return this.#visuals.get(id);
  }

  readonly #visualOf = (id: string): ContentBooth | undefined => this.#visuals.get(id);

  /** Reduced motion: new booths appear at full size instead of building up. */
  isReducedMotion = false;

  added(id: string): void {
    const placed = this.#model.lotOf(id);
    if (placed) this.#add(id, placed.lot, !this.isReducedMotion);
  }

  removed(id: string): void {
    this.shells.remove(id);
    this.signs.remove(id);
    this.content.forget(id);
    this.#visuals.delete(id);
    const i = this.anchors.findIndex((a) => a.id === id);
    if (i >= 0) this.anchors.splice(i, 1);
  }

  /** Name, media or tier changed: same lot, redrawn without the build-up. */
  updated(id: string): void {
    const placed = this.#model.lotOf(id);
    this.removed(id);
    if (placed) this.#add(id, placed.lot, false);
  }

  /** Street furniture for every lot (empty ones too); rebuilt when a district grows. */
  rebuildProps(): void {
    if (this.#props) {
      this.#props.set.dispose();
      if (this.#physics.isAlive) {
        for (const c of this.#props.colliders) this.#physics.world.removeCollider(c, false);
      }
    }
    const available = new Set(this.#art.props.ids);
    const placements = this.#model.layout.districts.flatMap((d) => planDistrictProps(d, available));
    this.#props = this.#art.props.build(placements, this.#physics);
    this.root.add(this.#props.set.group);
  }

  setTier(tier: QualityTier): void {
    this.content.setTier(tier);
  }

  update(dt: number, x: number, z: number): void {
    this.shells.update(dt);
    if (this.#growing.length > 0) {
      for (const id of this.#growing) {
        if (this.#signMatrix(id, world)) this.signs.setMatrix(id, world);
      }
      this.#growAge += dt;
      // One extra frame past the animation writes the final (scale 1) matrices.
      if (this.#growAge > BUILD_UP_S + dt) this.#growing.length = 0;
    }
    this.signs.update();
    this.content.update(dt, x, z, this.anchors, this.#visualOf);
  }

  cull(x: number, z: number, radius: number): void {
    this.shells.cull(x, z, radius);
    this.signs.cull(x, z, radius);
    this.#props?.set.cull(x, z, radius);
  }

  dispose(): void {
    this.content.dispose();
    this.signs.dispose();
    this.shells.dispose();
    this.#props?.set.dispose();
    this.#props = null;
    this.root.removeFromParent();
  }

  #add(id: string, lot: Lot, isAnimated: boolean): void {
    const booth = this.#model.booth(id);
    if (!booth) return;
    const district = this.#districts.get(booth.districtId);
    const theme = themeFor(district?.theme ?? '');
    const tier = this.#model.tierOf(id) ?? booth.tier;
    const visual: BoothVisual = {
      id,
      name: booth.name,
      tier,
      accent: new Color(accentFor(theme, id)),
      glow: new Color(district?.color ?? '#ffffff'),
      logoKey: booth.logoKey,
      media: booth.media,
      theme,
    };
    this.#visuals.set(id, visual);
    this.shells.add(
      { id, tier, lot, accent: visual.accent, glow: visual.glow, kitVariant: theme.kitVariant },
      isAnimated,
    );
    const colors = this.#signColorsFor(theme);
    if (this.#signMatrix(id, world)) {
      this.signs.add(id, booth.name, colors.board, colors.ink, world, lot.x, lot.z);
    }
    this.anchors.push({ id, x: lot.x, z: lot.z });
    if (isAnimated) {
      this.#growing.push(id);
      this.#growAge = 0;
    }
  }

  #signMatrix(id: string, out: Matrix4): boolean {
    const tier = this.shells.tierOf(id);
    if (!tier || !this.shells.slotLocal(tier, 'SLOT_sign', slot)) return false;
    if (!this.shells.boothMatrix(id, out)) return false;
    out.multiply(slot);
    return true;
  }

  #signColorsFor(theme: DistrictTheme): { board: Color; ink: Color } {
    let colors = this.#signColors.get(theme.key);
    if (!colors) {
      const s = theme.signage;
      colors = { board: new Color(s.board), ink: new Color(s.ink).multiplyScalar(s.inkIntensity) };
      this.#signColors.set(theme.key, colors);
    }
    return colors;
  }
}
