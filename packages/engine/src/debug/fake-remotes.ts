import {
  NET_ANIM,
  randomAvatarStyle,
  rng,
  SNAPSHOT_HZ,
  toNetPos,
  toNetYaw,
} from '@shipfair/shared';
import type { RemotePlayers } from '../avatars/remote.ts';
import type { ClockSync } from '../core/clock-sync.ts';
import type { System } from '../core/loop.ts';

// Fake remote players for the perf budget test and local checks without a realtime server: N
// players walking circles, fed through the same RemotePlayers path as real snapshots (join, then
// a snap every 1/SNAPSHOT_HZ s stamped with this page's clock, so the server offset is 0). Don't
// use it while connected: it would share the clock with the real shard.

const FIRST_ID = 40_000;
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));

interface Walker {
  readonly id: number;
  readonly cx: number;
  readonly cz: number;
  readonly radius: number;
  readonly speed: number;
  angle: number;
}

export class FakeRemotes implements System {
  readonly #remotes: RemotePlayers;
  readonly #clock: ClockSync;
  readonly #now: () => number;
  readonly #walkers: Walker[] = [];
  #since = 0;

  constructor(
    remotes: RemotePlayers,
    clock: ClockSync,
    opts: { count: number; seed: number; x: number; z: number; now?: () => number },
  ) {
    this.#remotes = remotes;
    this.#clock = clock;
    this.#now = opts.now ?? (() => performance.now());
    const random = rng(opts.seed);
    const t = this.#now();
    clock.onServerTime(t, t);
    for (let i = 0; i < opts.count; i++) {
      // A sunflower spiral of circle centres around (x, z), 2.5 m apart.
      const r = 2.5 * Math.sqrt(i + 1);
      const a = i * GOLDEN_ANGLE_RAD;
      const walker: Walker = {
        id: FIRST_ID + i,
        cx: opts.x + Math.cos(a) * r,
        cz: opts.z + Math.sin(a) * r,
        radius: 1 + random() * 2,
        speed: random() < 0.25 ? 0 : 1 + random() * 4,
        angle: random() * Math.PI * 2,
      };
      this.#walkers.push(walker);
      const [x, z, yaw] = this.#place(walker);
      remotes.join({
        id: walker.id,
        name: `Visitor ${i + 1}`,
        isGuest: i % 3 === 0,
        avatar: randomAvatarStyle(random),
        p: [toNetPos(x), 0, toNetPos(z)],
        r: toNetYaw(yaw),
        a: NET_ANIM.idle,
      });
    }
  }

  update(dt: number): void {
    this.#since += dt;
    if (this.#since < 1 / SNAPSHOT_HZ) return;
    for (const w of this.#walkers) w.angle += (w.speed / w.radius) * this.#since;
    this.#since = 0;
    const t = this.#now();
    this.#clock.onServerTime(t, t);
    for (const w of this.#walkers) {
      const [x, z, yaw] = this.#place(w);
      const anim = w.speed === 0 ? NET_ANIM.idle : w.speed > 3.5 ? NET_ANIM.run : NET_ANIM.walk;
      this.#remotes.snap(w.id, t, x, 0, z, yaw, anim);
    }
  }

  dispose(): void {
    for (const w of this.#walkers) this.#remotes.leave(w.id);
    this.#walkers.length = 0;
  }

  /** Position on the circle and the tangent heading (yaw: look direction is (sin, cos)). */
  #place(w: Walker): [number, number, number] {
    const x = w.cx + Math.cos(w.angle) * w.radius;
    const z = w.cz + Math.sin(w.angle) * w.radius;
    // d/dangle of (cos, sin) is (−sin, cos); yaw = atan2(dx, dz).
    return [x, z, Math.atan2(-Math.sin(w.angle), Math.cos(w.angle))];
  }
}
