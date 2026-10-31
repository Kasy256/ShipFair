import {
  type AvatarStyleV2,
  fromNetPos,
  fromNetYaw,
  HAIR_HEX,
  INTERP_DELAY_MS,
  NET_ANIM,
  PALETTE_HEX,
  type QualityTier,
  SKIN_HEX,
} from '@shipfair/shared';
import { Color, Group, type Vector3 } from 'three';
import {
  ANIM_IDLE_MPS,
  JOIN_FADE_S,
  LOD_REEVALUATE_S,
  LOD_SWAP_FADE_S,
  LOD1_ANIMATION_EVERY,
  NAME_TAG_MAX_DISTANCE_M,
  NAME_TAG_Y_M,
  STAND_IN_CHUNK,
} from '../config.ts';
import type { ClockSync } from '../core/clock-sync.ts';
import type { System } from '../core/loop.ts';
import { createSample, type RemoteSample, SnapshotBuffer } from '../core/snapshot-buffer.ts';
import type { PlayerSummaryLike, RemoteSink } from '../net/client.ts';
import type { AnimationSet } from './animation-set.ts';
import type { CharacterFactory } from './character-factory.ts';
import { GltfAvatar } from './gltf-avatar.ts';
import { assignLods, createLodScratch, type LodLevel, type LodScratch, STAND_IN } from './lod.ts';
import { NameTags } from './name-tags.ts';
import {
  advancePose,
  applyEmotePose,
  createPose,
  createPoseState,
  isLoopingEmote,
  type PoseState,
  STAND_IN_EMOTE_S,
} from './pose.ts';
import { PosedStandIns, TINT_FLOATS } from './posed-stand-ins.ts';

// Other visitors (ARCHITECTURE.md §4 and §7). Each is drawn INTERP_DELAY_MS in the past from
// its snapshot buffer. LODs follow the 04b policy, re-evaluated 4× a second: the nearest get a
// glTF character (LOD0, then LOD1), everyone else the instanced, posed stand-in in their own
// colours. Joins and leaves fade over JOIN_FADE_S; LOD swaps cross-fade over LOD_SWAP_FADE_S.
// Nothing here allocates per frame.

interface Remote {
  readonly id: number;
  readonly name: string;
  readonly isGuest: boolean;
  readonly uid: string | null;
  readonly style: AvatarStyleV2;
  readonly tints: Float32Array;
  readonly buffer: SnapshotBuffer;
  readonly sample: RemoteSample;
  readonly pose: PoseState;
  /** Join/leave fade: 0 → 1 after joining, → 0 when leaving (then removed). */
  fade: number;
  isLeaving: boolean;
  /** The emote playing on the stand-in (−1: none) and for how long. */
  emote: number;
  emoteS: number;
  /** When the last emote arrived (this page's clock, ms), for the test API. */
  emoteAtMs: number;
  lod: LodLevel;
  avatar: GltfAvatar | null;
  avatarFade: number;
  /** glTF avatars fading out after a LOD swap; disposed at 0. */
  retired: GltfAvatar[];
  retiredFade: number;
  /** Bumped per LOD change, so late-arriving builds are dropped. */
  version: number;
  /** Name tag atlas cell (−1: none). */
  tag: number;
  hasBadge: boolean;
}

export interface RemotePlayersOptions {
  clock: ClockSync;
  /** Camera position: LODs and name tags are measured from it. */
  viewer: Vector3;
  tier: QualityTier;
  /** Is this profile the maker of a live booth near (x, z)? For the "maker" badge. */
  isMakerNear?: ((uid: string, x: number, z: number) => boolean) | undefined;
  now?: () => number;
}

/** What the test API reads about one remote player. */
export interface RemoteView {
  id: number;
  name: string;
  isGuest: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  lod: LodLevel;
  /** The glTF avatar's dominant clip, or `stand-in:<emote id>` for an instanced player. */
  clip: string;
  /** The emote this player is playing (−1: none), set the moment it is received. */
  emote: number;
  /** Epoch ms when the last emote arrived and started playing (NaN: none yet). */
  emoteAt: number;
  hasBadge: boolean;
  isLeaving: boolean;
}

const pose = createPose();
const locomotion = { speed: 0, isGrounded: true, vy: 0 };
const color = new Color();
/** Ignore jitter: an emote ends only once a player clearly walks. */
const EMOTE_CANCEL_MPS = ANIM_IDLE_MPS * 3;

function tintsOf(style: AvatarStyleV2): Float32Array {
  const tints = new Float32Array(TINT_FLOATS);
  const hexes = [
    SKIN_HEX[style.skin],
    PALETTE_HEX[style.top.color],
    PALETTE_HEX[style.bottom.color],
    HAIR_HEX[style.hair.color],
  ];
  hexes.forEach((hex, k) => {
    color.setStyle(hex ?? '#888888');
    tints.set([color.r, color.g, color.b], k * 3);
  });
  return tints;
}

export class RemotePlayers implements System, RemoteSink {
  readonly root = new Group();
  readonly #opts: RemotePlayersOptions;
  readonly #now: () => number;
  readonly #byId = new Map<number, Remote>();
  readonly #list: Remote[] = [];
  readonly #standIns: PosedStandIns;
  readonly #tags: NameTags;
  readonly #pending = new Set<Promise<unknown>>();
  #factory: CharacterFactory | null = null;
  #animations: AnimationSet | null = null;
  #tier: QualityTier;
  #distances = new Float32Array(STAND_IN_CHUNK);
  #lods = new Uint8Array(STAND_IN_CHUNK);
  #scratch: LodScratch = createLodScratch(STAND_IN_CHUNK);
  #sinceEval = Number.POSITIVE_INFINITY;
  #time = 0;
  #active = 0;

  constructor(opts: RemotePlayersOptions) {
    this.#opts = opts;
    this.#now = opts.now ?? (() => performance.now());
    this.#tier = opts.tier;
    this.#standIns = new PosedStandIns(opts.tier);
    // Up to two tags per player (name and badge), for a full shard and then some.
    this.#tags = new NameTags(STAND_IN_CHUNK * 4);
    this.root.name = 'remote-players';
    this.root.add(this.#standIns.root, this.#tags.mesh);
  }

  /** Players shown and not leaving. */
  get size(): number {
    return this.#active;
  }

  /** GPU bytes of the name tag atlas (for the texture budget). */
  get textureBytes(): number {
    return this.#tags.bytes;
  }

  /** Art has loaded: from the next LOD pass the nearest players become glTF characters. */
  attachArt(factory: CharacterFactory | null, animations: AnimationSet | null): void {
    this.#factory = factory;
    this.#animations = animations;
    for (const r of this.#list) r.lod = STAND_IN; // re-assign everyone
    this.#sinceEval = Number.POSITIVE_INFINITY;
  }

  setTier(tier: QualityTier): void {
    this.#tier = tier;
    this.#standIns.setTier(tier);
    this.#sinceEval = Number.POSITIVE_INFINITY;
  }

  // --- RemoteSink (fed by NetClient) ----------------------------------------------------------

  welcome(players: readonly PlayerSummaryLike[]): void {
    for (const r of [...this.#list]) this.#remove(r);
    for (const p of players) this.join(p);
  }

  join(player: PlayerSummaryLike): void {
    const old = this.#byId.get(player.id);
    if (old) this.#remove(old);
    const clock = this.#opts.clock;
    // Summaries carry no time: stamp them "now" on the render timeline (or 0 before the first
    // snap), so the first snaps interpolate onward from where the player was announced.
    const t = clock.isReady ? clock.serverNow(this.#now()) - INTERP_DELAY_MS : 0;
    const buffer = new SnapshotBuffer();
    const [x, y, z] = player.p;
    buffer.push(t, fromNetPos(x), fromNetPos(y), fromNetPos(z), fromNetYaw(player.r), player.a);
    const remote: Remote = {
      id: player.id,
      name: player.name,
      isGuest: player.isGuest,
      uid: player.uid ?? null,
      style: player.avatar,
      tints: tintsOf(player.avatar),
      buffer,
      sample: createSample(),
      pose: createPoseState(),
      fade: 0,
      isLeaving: false,
      emote: -1,
      emoteS: 0,
      emoteAtMs: Number.NaN,
      lod: STAND_IN,
      avatar: null,
      avatarFade: 0,
      retired: [],
      retiredFade: 0,
      version: 0,
      tag: this.#tags.acquire(player.name),
      hasBadge: false,
    };
    buffer.sample(t, remote.sample);
    this.#byId.set(player.id, remote);
    this.#list.push(remote);
    this.#active++;
    this.#standIns.ensure(this.#list.length);
    this.#sinceEval = Number.POSITIVE_INFINITY;
  }

  leave(id: number): void {
    const r = this.#byId.get(id);
    if (!r || r.isLeaving) return;
    r.isLeaving = true;
    this.#active--;
  }

  snap(id: number, t: number, x: number, y: number, z: number, yaw: number, anim: number): void {
    this.#byId.get(id)?.buffer.push(t, x, y, z, yaw, anim);
  }

  emote(id: number, e: number): void {
    const r = this.#byId.get(id);
    if (!r || r.isLeaving) return;
    r.emote = e;
    r.emoteS = 0;
    r.emoteAtMs = this.#now();
    r.avatar?.playEmote(e);
  }

  nameOf(id: number): string | null {
    return this.#byId.get(id)?.name ?? null;
  }

  clear(): void {
    for (const id of this.#byId.keys()) this.leave(id);
  }

  // --- per frame ------------------------------------------------------------------------------

  update(dt: number): void {
    this.#time += dt;
    this.#sinceEval += dt;
    if (this.#sinceEval >= LOD_REEVALUATE_S) {
      this.#sinceEval = 0;
      this.#evaluate();
    }
    const clock = this.#opts.clock;
    const renderT = clock.serverNow(this.#now()) - INTERP_DELAY_MS;
    const v = this.#opts.viewer;
    const fadeStep = dt / JOIN_FADE_S;
    this.#standIns.begin();
    this.#tags.begin();
    for (let i = this.#list.length - 1; i >= 0; i--) {
      const r = this.#list[i];
      if (!r) continue;
      r.fade = r.isLeaving ? Math.max(0, r.fade - fadeStep) : Math.min(1, r.fade + fadeStep);
      if (r.isLeaving && r.fade === 0) {
        this.#remove(r);
        continue;
      }
      const s = r.sample;
      r.buffer.sample(clock.isReady ? renderT : r.buffer.newest, s);
      if (r.emote >= 0) {
        r.emoteS += dt;
        const isDone = !isLoopingEmote(r.emote) && r.emoteS > STAND_IN_EMOTE_S;
        if (isDone || s.speed > EMOTE_CANCEL_MPS) r.emote = -1;
      }
      const standInFade = this.#drawAvatars(r, dt);
      if (standInFade > 0) this.#drawStandIn(r, dt, standInFade);
      const dx = s.x - v.x;
      const dy = s.y + NAME_TAG_Y_M - v.y;
      const dz = s.z - v.z;
      // Not Math.hypot: it is variadic and allocates in V8.
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance <= NAME_TAG_MAX_DISTANCE_M) {
        this.#tags.add(
          r.tag,
          r.isGuest,
          r.hasBadge,
          s.x,
          s.y + NAME_TAG_Y_M,
          s.z,
          distance,
          r.fade,
        );
      }
    }
    this.#standIns.end();
    this.#tags.end();
  }

  /** Moves and fades the glTF avatars; returns how solid the stand-in should be. */
  #drawAvatars(r: Remote, dt: number): number {
    const s = r.sample;
    const swapStep = dt / LOD_SWAP_FADE_S;
    if (r.retired.length > 0) {
      r.retiredFade = Math.max(0, r.retiredFade - swapStep);
      for (const a of r.retired) a.setFade(r.retiredFade * r.fade);
      if (r.retiredFade === 0) this.#dropRetired(r);
    }
    const a = r.avatar;
    if (!a) return r.fade * (r.retired.length > 0 ? 1 - r.retiredFade : 1);
    r.avatarFade = Math.min(1, r.avatarFade + swapStep);
    a.object.position.set(s.x, s.y, s.z);
    a.object.rotation.y = s.yaw;
    a.setLocomotion(s.speed, s.anim !== NET_ANIM.air, 0);
    a.setFade(r.fade * r.avatarFade);
    a.update(dt, this.#time);
    return r.fade * (1 - r.avatarFade);
  }

  #drawStandIn(r: Remote, dt: number, fade: number): void {
    const s = r.sample;
    locomotion.speed = s.speed;
    locomotion.isGrounded = s.anim !== NET_ANIM.air;
    locomotion.vy = 0;
    advancePose(r.pose, locomotion, dt, this.#time, pose);
    if (r.emote >= 0) applyEmotePose(r.emote, r.emoteS, pose);
    this.#standIns.add(r.tints, s.x, s.y, s.z, s.yaw, pose, fade);
  }

  // --- LOD ------------------------------------------------------------------------------------

  #evaluate(): void {
    const n = this.#list.length;
    this.#grow(n);
    const v = this.#opts.viewer;
    const isMakerNear = this.#opts.isMakerNear;
    for (let i = 0; i < n; i++) {
      const r = this.#list[i];
      if (!r) continue;
      const s = r.sample;
      // Leaving players rank last, so they never take a glTF slot from someone staying.
      const dx = s.x - v.x;
      const dz = s.z - v.z;
      this.#distances[i] = r.isLeaving ? Number.MAX_VALUE : Math.sqrt(dx * dx + dz * dz);
      this.#lods[i] = r.lod;
      r.hasBadge = r.uid !== null && (isMakerNear?.(r.uid, s.x, s.z) ?? false);
    }
    assignLods(this.#distances, this.#lods, n, this.#tier, this.#scratch);
    for (let i = 0; i < n; i++) {
      const r = this.#list[i];
      const lod = (this.#lods[i] ?? STAND_IN) as LodLevel;
      if (r && !r.isLeaving && lod !== r.lod) this.#change(r, lod);
    }
  }

  #change(r: Remote, lod: LodLevel): void {
    const version = ++r.version;
    r.lod = lod;
    if (r.avatar) {
      r.retired.push(r.avatar);
      r.retiredFade = r.avatarFade;
      r.avatar = null;
    }
    const factory = this.#factory;
    const animations = this.#animations;
    if (lod === STAND_IN || !factory || !animations) return;
    const build = GltfAvatar.create(factory, animations, r.style, lod).then(
      (avatar) => {
        if (version !== r.version || r.isLeaving) {
          avatar.dispose();
          return;
        }
        avatar.animEvery = lod === 0 ? 1 : LOD1_ANIMATION_EVERY;
        avatar.setFade(0);
        if (r.emote >= 0) avatar.playEmote(r.emote);
        r.avatar = avatar;
        r.avatarFade = 0;
        this.root.add(avatar.object);
      },
      (error: unknown) =>
        console.warn('Remote avatar failed to build; keeping the stand-in.', error),
    );
    this.#pending.add(build);
    void build.finally(() => this.#pending.delete(build));
  }

  #grow(n: number): void {
    if (n <= this.#distances.length) return;
    const size = Math.ceil(n / STAND_IN_CHUNK) * STAND_IN_CHUNK;
    this.#distances = new Float32Array(size);
    this.#lods = new Uint8Array(size);
    this.#scratch = createLodScratch(size);
  }

  #dropRetired(r: Remote): void {
    for (const a of r.retired) a.dispose();
    r.retired.length = 0;
  }

  #remove(r: Remote): void {
    r.version++;
    r.avatar?.dispose();
    r.avatar = null;
    this.#dropRetired(r);
    this.#tags.release(r.tag);
    if (!r.isLeaving) this.#active--;
    this.#byId.delete(r.id);
    const i = this.#list.indexOf(r);
    const last = this.#list.pop();
    if (last && last !== r && i >= 0) this.#list[i] = last;
  }

  // --- tests and dev ----------------------------------------------------------------------------

  /** A plain-data view of every remote player (the test API; allocates). */
  views(): RemoteView[] {
    return this.#list.map((r) => ({
      id: r.id,
      name: r.name,
      isGuest: r.isGuest,
      x: r.sample.x,
      y: r.sample.y,
      z: r.sample.z,
      yaw: r.sample.yaw,
      lod: r.avatar ? r.lod : STAND_IN,
      clip: r.avatar ? r.avatar.activeClip : `stand-in:${r.emote}`,
      emote: r.emote,
      emoteAt: performance.timeOrigin + r.emoteAtMs,
      hasBadge: r.hasBadge,
      isLeaving: r.isLeaving,
    }));
  }

  /** Stand-ins and name tags drawn last frame. */
  drawn(): { standIns: number; tags: number } {
    return { standIns: this.#standIns.count, tags: this.#tags.count };
  }

  /** Resolves once every avatar build started so far has finished. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
  }

  dispose(): void {
    for (const r of [...this.#list]) this.#remove(r);
    this.#standIns.dispose();
    this.#tags.dispose();
    this.root.removeFromParent();
  }
}
