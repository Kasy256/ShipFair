import {
  type AvatarStyleV2,
  type EventBus,
  nearestBooth,
  type QualityTier,
} from '@shipfair/shared';
import type { Scene, Vector3 } from 'three';
import type { Art } from '../art.ts';
import { RemotePlayers } from '../avatars/remote.ts';
import { MAKER_BADGE_RADIUS_M } from '../config.ts';
import { ClockSync } from '../core/clock-sync.ts';
import type { Loop } from '../core/loop.ts';
import { FakeRemotes } from '../debug/fake-remotes.ts';
import type { PlayerSystem } from '../player/player-system.ts';
import type { City } from '../world/city.ts';
import { type LocalNetState, NetClient, type NetConnectOptions } from './client.ts';

/**
 * The engine's multiplayer parts, wired together: the realtime client, the server clock
 * estimate and the remote players it feeds. The local player's emotes are sent, server
 * corrections reach it, and the scene shows everyone else. Exploring works the same without it.
 */
export class Multiplayer {
  readonly clock = new ClockSync();
  readonly remotes: RemotePlayers;
  readonly client: NetClient;
  readonly #loop: Loop;
  #fake: FakeRemotes | null = null;

  constructor(opts: {
    loop: Loop;
    bus: EventBus;
    scene: Scene;
    player: PlayerSystem;
    city: City | null;
    viewer: Vector3;
    tier: QualityTier;
    avatar: () => AvatarStyleV2;
  }) {
    const { player, city } = opts;
    this.#loop = opts.loop;
    this.remotes = opts.loop.add(
      new RemotePlayers({
        clock: this.clock,
        viewer: opts.viewer,
        tier: opts.tier,
        isMakerNear: city ? (uid, x, z) => isMakerNear(city, uid, x, z) : undefined,
      }),
    );
    opts.scene.add(this.remotes.root);
    const local: LocalNetState = { x: 0, y: 0, z: 0, yaw: 0, anim: 0 };
    this.client = opts.loop.add(
      new NetClient({
        bus: opts.bus,
        remotes: this.remotes,
        clock: this.clock,
        avatar: opts.avatar,
        local: () => {
          const p = player.controller.position;
          local.x = p.x;
          local.y = p.y;
          local.z = p.z;
          local.yaw = player.controller.yaw;
          local.anim = player.netAnim;
          return local;
        },
        correct: (x, y, z) => player.correct(x, y, z),
      }),
    );
    player.onEmote = (emote) => this.client.sendEmote(emote);
  }

  connect(options: NetConnectOptions): void {
    this.clearFake();
    this.client.connect(options);
  }

  attachArt(art: Art): void {
    this.remotes.attachArt(art.factory, art.animations);
  }

  setTier(tier: QualityTier): void {
    this.remotes.setTier(tier);
  }

  /** Test and dev: `count` fake visitors walking around (x, z). Only while offline. */
  fake(count: number, seed: number, x: number, z: number): void {
    this.clearFake();
    this.#fake = this.#loop.add(new FakeRemotes(this.remotes, this.clock, { count, seed, x, z }));
  }

  clearFake(): void {
    if (!this.#fake) return;
    this.#loop.remove(this.#fake);
    this.#fake.dispose();
    this.#fake = null;
  }
}

/** True when `uid` owns the live booth nearest (x, z) within MAKER_BADGE_RADIUS_M. */
function isMakerNear(city: City, uid: string, x: number, z: number): boolean {
  const anchor = nearestBooth(city.layout, x, z, MAKER_BADGE_RADIUS_M);
  if (!anchor || !city.model.isLive(anchor.boothId)) return false;
  return city.model.booth(anchor.boothId)?.ownerId === uid;
}
