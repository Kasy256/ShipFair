import { type AvatarStyleV2, type QualityTier, randomAvatarStyle, rng } from '@shipfair/shared';
import { Group, type Vector3 } from 'three';
import { LOD_REEVALUATE_S, LOD_SWAP_FADE_S, LOD1_ANIMATION_EVERY } from '../config.ts';
import type { System } from '../core/loop.ts';
import type { AnimationSet } from './animation-set.ts';
import type { CharacterFactory } from './character-factory.ts';
import { GltfAvatar } from './gltf-avatar.ts';
import { assignLods, countLods, createLodScratch, type LodLevel, STAND_IN } from './lod.ts';
import { StandIns } from './stand-ins.ts';

interface Member {
  readonly style: AvatarStyleV2;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** The glTF avatar currently shown (LOD0/LOD1), fading in toward 1. */
  avatar: GltfAvatar | null;
  avatarLod: LodLevel;
  fade: number;
  /** Avatars fading out after a LOD swap; disposed at fade 0. */
  leaving: GltfAvatar[];
  leavingFade: number;
  /** Bumped per LOD change so late-arriving builds are dropped. */
  version: number;
}

const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));

/**
 * A crowd of stand-in remote players following the LOD policy (ARCHITECTURE.md §4). Prompt 11's
 * networked `remote.ts` does the same with real players; this one drives the e2e LOD test and
 * the /dev/assets page. LODs are re-evaluated 4× a second, swaps cross-fade over 200 ms.
 */
export class Crowd implements System {
  readonly root = new Group();
  readonly #members: Member[] = [];
  readonly #factory: CharacterFactory | null;
  readonly #animations: AnimationSet | null;
  readonly #viewer: Vector3;
  readonly #standIns: StandIns;
  readonly #distances: Float32Array;
  readonly #lods: Uint8Array;
  readonly #scratch;
  readonly #counts: [number, number, number] = [0, 0, 0];
  readonly #pending = new Set<Promise<unknown>>();
  #tier: QualityTier;
  #sinceEval = Number.POSITIVE_INFINITY;

  constructor(opts: {
    capacity: number;
    factory: CharacterFactory | null;
    animations: AnimationSet | null;
    viewer: Vector3;
    tier: QualityTier;
  }) {
    this.#factory = opts.factory;
    this.#animations = opts.animations;
    this.#viewer = opts.viewer;
    this.#tier = opts.tier;
    this.#standIns = new StandIns(opts.capacity);
    this.#distances = new Float32Array(opts.capacity);
    this.#lods = new Uint8Array(opts.capacity).fill(STAND_IN);
    this.#scratch = createLodScratch(opts.capacity);
    this.root.name = 'crowd';
    this.root.add(this.#standIns.mesh);
  }

  get size(): number {
    return this.#members.length;
  }

  /** Adds `count` members on a sunflower spiral around (cx, cz), `spacing` metres apart. */
  spawn(count: number, seed: number, cx: number, cz: number, spacing = 2.5): void {
    const random = rng(seed);
    const room = this.#distances.length - this.#members.length;
    for (let i = 0; i < Math.min(count, room); i++) {
      const r = spacing * Math.sqrt(i + 1);
      const a = i * GOLDEN_ANGLE_RAD;
      this.#members.push({
        style: randomAvatarStyle(random),
        x: cx + Math.cos(a) * r,
        z: cz + Math.sin(a) * r,
        yaw: random() * Math.PI * 2,
        avatar: null,
        avatarLod: STAND_IN,
        fade: 1,
        leaving: [],
        leavingFade: 0,
        version: 0,
      });
    }
    this.#sinceEval = Number.POSITIVE_INFINITY;
  }

  setTier(tier: QualityTier): void {
    this.#tier = tier;
    this.#sinceEval = Number.POSITIVE_INFINITY;
  }

  /** Target LOD counts [LOD0, LOD1, stand-in] from the last evaluation. */
  counts(): readonly [number, number, number] {
    return countLods(this.#lods, this.#members.length, this.#counts);
  }

  /** Counts of what is actually on screen (glTF avatars that finished building). */
  shownCounts(): [number, number, number] {
    const shown: [number, number, number] = [0, 0, 0];
    for (const m of this.#members) shown[m.avatar ? m.avatarLod : STAND_IN]++;
    return shown;
  }

  /** Resolves once every avatar build started so far has finished. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
  }

  update(dt: number): void {
    this.#sinceEval += dt;
    if (this.#sinceEval >= LOD_REEVALUATE_S) {
      this.#sinceEval = 0;
      this.#evaluate();
    }
    const step = dt / LOD_SWAP_FADE_S;
    for (const m of this.#members) {
      if (m.avatar) {
        m.fade = Math.min(1, m.fade + step);
        m.avatar.setFade(m.fade);
        m.avatar.update(dt, 0);
      }
      if (m.leaving.length > 0) {
        m.leavingFade -= step;
        for (const a of m.leaving) a.setFade(Math.max(0, m.leavingFade));
        if (m.leavingFade <= 0) this.#dropLeaving(m);
      }
    }
  }

  dispose(): void {
    for (const m of this.#members) {
      m.version++;
      m.avatar?.dispose();
      this.#dropLeaving(m);
    }
    this.#members.length = 0;
    this.#standIns.dispose();
    this.root.removeFromParent();
  }

  #evaluate(): void {
    const n = this.#members.length;
    const v = this.#viewer;
    for (let i = 0; i < n; i++) {
      const m = this.#members[i];
      if (m) this.#distances[i] = Math.hypot(m.x - v.x, m.z - v.z);
    }
    assignLods(this.#distances, this.#lods, n, this.#tier, this.#scratch);
    let visible = 0;
    for (let i = 0; i < n; i++) {
      const m = this.#members[i];
      if (!m) continue;
      const lod = (this.#lods[i] ?? STAND_IN) as LodLevel;
      if (lod !== m.avatarLod) this.#change(m, lod);
      // Stand-in shows while the member has no finished glTF avatar.
      if (!m.avatar) this.#standIns.set(visible++, m.style, m.x, 0, m.z, m.yaw);
    }
    this.#standIns.count = visible;
  }

  #change(m: Member, lod: LodLevel): void {
    const version = ++m.version;
    m.avatarLod = lod;
    this.#retire(m);
    if (lod === STAND_IN || !this.#factory || !this.#animations) return;
    const build = GltfAvatar.create(this.#factory, this.#animations, m.style, lod).then(
      (avatar) => {
        if (version !== m.version) {
          avatar.dispose();
          return;
        }
        avatar.object.position.set(m.x, 0, m.z);
        avatar.object.rotation.y = m.yaw;
        avatar.animEvery = lod === 0 ? 1 : LOD1_ANIMATION_EVERY;
        avatar.setFade(0);
        m.fade = 0;
        m.avatar = avatar;
        this.root.add(avatar.object);
        this.#sinceEval = Number.POSITIVE_INFINITY; // repack stand-ins next frame
      },
      (error: unknown) =>
        console.warn('Crowd avatar failed to build; keeping the stand-in.', error),
    );
    this.#pending.add(build);
    void build.finally(() => this.#pending.delete(build));
  }

  #retire(m: Member): void {
    if (!m.avatar) return;
    m.leaving.push(m.avatar);
    m.leavingFade = 1;
    m.avatar = null;
  }

  #dropLeaving(m: Member): void {
    for (const a of m.leaving) a.dispose();
    m.leaving.length = 0;
  }
}
