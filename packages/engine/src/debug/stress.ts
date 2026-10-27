import type RAPIER from '@dimforge/rapier3d-compat';
import {
  type BoothTier,
  hashString,
  type LayoutBooth,
  layoutCity,
  PALETTE_HEX,
  pick,
  type QualityTier,
  rng,
} from '@shipfair/shared';
import { Color, Group, Matrix4, Quaternion, type Scene, Vector3 } from 'three';
import type { Art } from '../art.ts';
import { Crowd } from '../avatars/crowd.ts';
import type { KitBooth } from '../booths/kit.ts';
import { DRAW_DISTANCE_M, LOD_REEVALUATE_S } from '../config.ts';
import type { System } from '../core/loop.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import type { InstanceSet } from '../render/instance-set.ts';
import { planDistrictProps } from '../world/prop-plan.ts';

// Test and dev scenes: a city of N booths with props, and a crowd of fake remote players. Used
// by the e2e budget and LOD tests and /dev/assets until prompts 05 and 11 build the real ones.

const DISTRICTS = [
  ['ai-agents', '#7c3aed'],
  ['dev-tools', '#0ea5e9'],
  ['productivity', '#22c55e'],
  ['design', '#f97316'],
  ['marketing', '#ec4899'],
  ['finance-ops', '#eab308'],
  ['games-fun', '#ef4444'],
  ['weird', '#14b8a6'],
].map(([slug = '', color = '#ffffff'], i) => ({
  id: i + 1,
  slug,
  theme: slug,
  color,
  sortOrder: i,
}));
/** Accent colours booths are tinted with (the palette's accent squares). */
const ACCENTS = PALETTE_HEX.slice(8, 14);
const CROWD_CAPACITY = 64;
const MINUTE_MS = 60_000;

function fakeBooths(count: number, seed: number): LayoutBooth[] {
  const random = rng(seed);
  const base = Date.UTC(2026, 9, 1);
  return Array.from({ length: count }, (_, i) => {
    const roll = random();
    const tier: BoothTier = roll < 0.04 ? 'pavilion' : roll < 0.24 ? 'booth' : 'stall';
    return {
      id: `stress-${seed}-${String(i).padStart(4, '0')}`,
      districtId: pick(random, DISTRICTS).id,
      approvedAt: new Date(base + i * MINUTE_MS).toISOString(),
      tier,
    };
  });
}

export class StressScene implements System {
  readonly root = new Group();
  crowd: Crowd | null = null;
  readonly #art: Art;
  readonly #physics: PhysicsWorld;
  readonly #viewer: Vector3;
  readonly #tier: () => QualityTier;
  #colliders: RAPIER.Collider[] = [];
  #booths: KitBooth[] = [];
  #sets: InstanceSet[] = [];
  #sinceCull = Number.POSITIVE_INFINITY;

  /** `viewer` is the camera position: draw distance and crowd LODs are measured from it. */
  constructor(
    art: Art,
    scene: Scene,
    physics: PhysicsWorld,
    viewer: Vector3,
    tier: () => QualityTier,
  ) {
    this.#art = art;
    this.#physics = physics;
    this.#viewer = viewer;
    this.#tier = tier;
    this.root.name = 'stress';
    scene.add(this.root);
  }

  get booths(): readonly KitBooth[] {
    return this.#booths;
  }

  /** Lays out `count` booths across 8 districts with props. Replaces any previous city. */
  buildCity(count: number, seed = 1): { booths: number; props: number } {
    this.clearCity();
    const layout = layoutCity(DISTRICTS, fakeBooths(count, seed));
    const color = (hex: string) => new Color().setStyle(hex);
    const up = new Vector3(0, 1, 0);
    for (const district of layout.districts) {
      const glow = color(DISTRICTS.find((d) => d.id === district.id)?.color ?? '#ffffff');
      for (const lot of district.lots) {
        if (!lot.boothId || !lot.tier) continue;
        const accent = color(ACCENTS[hashString(lot.boothId) % ACCENTS.length] ?? '#ffffff');
        const matrix = new Matrix4().compose(
          new Vector3(lot.x, 0, lot.z),
          new Quaternion().setFromAxisAngle(up, (lot.facing * Math.PI) / 2),
          new Vector3(1, 1, 1),
        );
        this.#booths.push({
          tier: `tier_${lot.tier}`,
          matrix,
          accent,
          glow,
          theme: district.theme,
        });
      }
    }
    const kit = this.#art.kit.build(this.#booths);
    const available = new Set(this.#art.props.ids);
    const placements = layout.districts.flatMap((d) => planDistrictProps(d, available));
    const props = this.#art.props.build(placements, this.#physics);
    this.#colliders = props.colliders;
    this.#sets = [kit, props.set];
    for (const set of this.#sets) this.root.add(set.group);
    this.#cull();
    return { booths: this.#booths.length, props: placements.length };
  }

  /** Booth and prop instances drawn after the last draw-distance pass. */
  get drawnInstances(): number {
    return this.#sets.reduce((n, s) => n + s.drawn, 0);
  }

  clearCity(): void {
    for (const set of this.#sets) set.dispose();
    this.#sets = [];
    for (const c of this.#colliders) this.#physics.world.removeCollider(c, false);
    this.#colliders = [];
    this.#booths = [];
  }

  /** Adds a crowd of fake remote players around (x, z), LOD'd against the viewer. */
  spawnCrowd(count: number, seed: number, x: number, z: number): Crowd {
    if (!this.crowd) {
      this.crowd = new Crowd({
        capacity: CROWD_CAPACITY,
        factory: this.#art.factory,
        animations: this.#art.animations,
        viewer: this.#viewer,
        tier: this.#tier(),
      });
      this.root.add(this.crowd.root);
    }
    this.crowd.spawn(count, seed, x, z);
    return this.crowd;
  }

  update(dt: number): void {
    this.#sinceCull += dt;
    if (this.#sinceCull >= LOD_REEVALUATE_S) this.#cull();
    this.crowd?.setTier(this.#tier());
    this.crowd?.update(dt);
  }

  #cull(): void {
    this.#sinceCull = 0;
    const radius = DRAW_DISTANCE_M[this.#tier()];
    for (const set of this.#sets) set.cull(this.#viewer.x, this.#viewer.z, radius);
  }

  dispose(): void {
    this.clearCity();
    this.crowd?.dispose();
    this.crowd = null;
    this.root.removeFromParent();
  }
}
