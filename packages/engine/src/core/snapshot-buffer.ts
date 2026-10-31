import { EXTRAP_MAX_MS, NET_ANIM } from '@shipfair/shared';
import { EXTRAP_MAX_GAP_MS, SNAPSHOT_BUFFER_SIZE } from '../config.ts';

// Remote-player interpolation (ARCHITECTURE.md §7): each player keeps its last few snapshots,
// stamped with server time, and is drawn INTERP_DELAY_MS in the past, between two of them. Past
// the newest it extrapolates for at most EXTRAP_MAX_MS, then holds. Pure and allocation-free.

const TAU = 2 * Math.PI;

/** The signed turn from `from` to `to` the short way round, in (−π, π]. */
export function shortestArc(from: number, to: number): number {
  const d = (((to - from) % TAU) + TAU) % TAU; // [0, 2π)
  return d > Math.PI ? d - TAU : d;
}

/** Yaw between `a` and `b` along the short arc (not wrapped into [0, 2π)). */
export const lerpYaw = (a: number, b: number, t: number): number => a + shortestArc(a, b) * t;

/** Where a remote player is drawn this frame. One object per player, rewritten by `sample`. */
export interface RemoteSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Horizontal speed (m/s) of the segment being drawn; 0 while holding. */
  speed: number;
  anim: number;
  isExtrapolating: boolean;
}

export const createSample = (): RemoteSample => ({
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  speed: 0,
  anim: NET_ANIM.idle,
  isExtrapolating: false,
});

/** The newest SNAPSHOT_BUFFER_SIZE snapshots of one player, kept sorted by server time. */
export class SnapshotBuffer {
  readonly #t = new Float64Array(SNAPSHOT_BUFFER_SIZE);
  readonly #x = new Float64Array(SNAPSHOT_BUFFER_SIZE);
  readonly #y = new Float64Array(SNAPSHOT_BUFFER_SIZE);
  readonly #z = new Float64Array(SNAPSHOT_BUFFER_SIZE);
  readonly #yaw = new Float64Array(SNAPSHOT_BUFFER_SIZE);
  readonly #anim = new Uint8Array(SNAPSHOT_BUFFER_SIZE);
  #count = 0;

  get count(): number {
    return this.#count;
  }

  /** Server time of the oldest snapshot kept (NaN when empty). */
  get oldest(): number {
    return this.#count > 0 ? (this.#t[0] ?? Number.NaN) : Number.NaN;
  }

  /** Server time of the newest snapshot (NaN when empty). */
  get newest(): number {
    return this.#count > 0 ? (this.#t[this.#count - 1] ?? Number.NaN) : Number.NaN;
  }

  clear(): void {
    this.#count = 0;
  }

  /**
   * Adds a snapshot in time order. A late one is slotted in place; one for a time already held
   * is ignored; when full, the oldest is dropped (and anything older than all of them is too).
   */
  push(t: number, x: number, y: number, z: number, yaw: number, anim: number): void {
    const times = this.#t;
    let at = this.#count;
    while (at > 0 && (times[at - 1] ?? 0) > t) at--;
    if (at > 0 && times[at - 1] === t) return;
    if (this.#count === SNAPSHOT_BUFFER_SIZE) {
      if (at === 0) return;
      this.#shiftLeft(); // drop the oldest; the slot moves down with everything else
      at--;
    }
    for (let i = this.#count; i > at; i--) this.#copy(i - 1, i);
    times[at] = t;
    this.#x[at] = x;
    this.#y[at] = y;
    this.#z[at] = z;
    this.#yaw[at] = yaw;
    this.#anim[at] = anim;
    this.#count++;
  }

  /** Writes the state at server time `t` into `out`. False (and `out` untouched) when empty. */
  sample(t: number, out: RemoteSample): boolean {
    const n = this.#count;
    if (n === 0) return false;
    const times = this.#t;
    out.isExtrapolating = false;
    if (t <= (times[0] ?? 0) || n === 1) return this.#hold(0, out);
    const last = n - 1;
    const tLast = times[last] ?? 0;
    if (t >= tLast) return this.#extrapolate(t, out);
    let i = 0;
    while ((times[i + 1] ?? 0) <= t) i++;
    const t0 = times[i] ?? 0;
    const span = (times[i + 1] ?? 0) - t0;
    this.#between(i, i + 1, (t - t0) / span, span, out);
    out.anim = this.#anim[i] ?? NET_ANIM.idle;
    return true;
  }

  #extrapolate(t: number, out: RemoteSample): boolean {
    const last = this.#count - 1;
    const prev = last - 1;
    const tLast = this.#t[last] ?? 0;
    const gap = tLast - (this.#t[prev] ?? 0);
    const isMoving = this.#anim[last] !== NET_ANIM.idle;
    if (!isMoving || gap > EXTRAP_MAX_GAP_MS) return this.#hold(last, out);
    const ahead = Math.min(t - tLast, EXTRAP_MAX_MS);
    // Linear extension of the last segment: alpha > 1 continues past the newest snapshot.
    this.#between(prev, last, 1 + ahead / gap, gap, out);
    out.yaw = this.#yaw[last] ?? 0;
    out.anim = this.#anim[last] ?? NET_ANIM.idle;
    out.isExtrapolating = true;
    if (t - tLast >= EXTRAP_MAX_MS) out.speed = 0; // held at the cap
    return true;
  }

  #between(a: number, b: number, alpha: number, spanMs: number, out: RemoteSample): void {
    const xa = this.#x[a] ?? 0;
    const za = this.#z[a] ?? 0;
    const dx = (this.#x[b] ?? 0) - xa;
    const dz = (this.#z[b] ?? 0) - za;
    const ya = this.#y[a] ?? 0;
    out.x = xa + dx * alpha;
    out.y = ya + ((this.#y[b] ?? 0) - ya) * alpha;
    out.z = za + dz * alpha;
    out.yaw = lerpYaw(this.#yaw[a] ?? 0, this.#yaw[b] ?? 0, Math.min(alpha, 1));
    out.speed = spanMs > 0 ? Math.hypot(dx, dz) / (spanMs / 1000) : 0;
  }

  #hold(i: number, out: RemoteSample): boolean {
    out.x = this.#x[i] ?? 0;
    out.y = this.#y[i] ?? 0;
    out.z = this.#z[i] ?? 0;
    out.yaw = this.#yaw[i] ?? 0;
    out.speed = 0;
    out.anim = this.#anim[i] ?? NET_ANIM.idle;
    return true;
  }

  #copy(from: number, to: number): void {
    this.#t[to] = this.#t[from] ?? 0;
    this.#x[to] = this.#x[from] ?? 0;
    this.#y[to] = this.#y[from] ?? 0;
    this.#z[to] = this.#z[from] ?? 0;
    this.#yaw[to] = this.#yaw[from] ?? 0;
    this.#anim[to] = this.#anim[from] ?? 0;
  }

  #shiftLeft(): void {
    for (let i = 1; i < this.#count; i++) this.#copy(i, i - 1);
    this.#count--;
  }
}
