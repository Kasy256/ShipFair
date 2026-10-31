import { CLOCK_SLEW, CLOCK_SNAP_MS, CLOCK_WINDOW, RTT_SMOOTHING } from '../config.ts';

/**
 * Estimates the server clock from snapshot arrival times and the ping RTT, so remote players can
 * be drawn at a server time. Every snapshot gives `server t − local arrival = offset − delay`,
 * and the delay is never negative, so the largest recent sample is the one that travelled
 * fastest. Adding half the RTT for that fastest trip gives the offset. Small changes ease in
 * (CLOCK_SLEW per sample) so remote players never jump; large ones (a restarted server, a tab
 * that slept) are taken at once. Pure: the caller passes every time in.
 */
export class ClockSync {
  readonly #samples = new Float64Array(CLOCK_WINDOW);
  #count = 0;
  #next = 0;
  /** server time = local time + offsetMs. NaN until the first server time. */
  offsetMs = Number.NaN;
  /** Smoothed ping round trip in ms. NaN until the first pong. */
  rttMs = Number.NaN;

  get isReady(): boolean {
    return !Number.isNaN(this.offsetMs);
  }

  /** A `pong` for a `ping` sent at local time `sentMs`, received at `nowMs`. */
  onPong(sentMs: number, nowMs: number): void {
    const rtt = Math.max(0, nowMs - sentMs);
    this.rttMs = Number.isNaN(this.rttMs) ? rtt : this.rttMs + (rtt - this.rttMs) * RTT_SMOOTHING;
  }

  /** A server-stamped message (`snap.t`) that arrived at local time `arrivalMs`. */
  onServerTime(serverMs: number, arrivalMs: number): void {
    this.#samples[this.#next] = serverMs - arrivalMs;
    this.#next = (this.#next + 1) % CLOCK_WINDOW;
    this.#count = Math.min(this.#count + 1, CLOCK_WINDOW);
    let fastest = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < this.#count; i++) fastest = Math.max(fastest, this.#samples[i] ?? 0);
    const target = fastest + (Number.isNaN(this.rttMs) ? 0 : this.rttMs / 2);
    if (Number.isNaN(this.offsetMs) || Math.abs(target - this.offsetMs) > CLOCK_SNAP_MS) {
      this.offsetMs = target;
    } else {
      this.offsetMs += (target - this.offsetMs) * CLOCK_SLEW;
    }
  }

  /** The server's clock now, given local time `localMs` (meaningless until `isReady`). */
  serverNow(localMs: number): number {
    return localMs + (Number.isNaN(this.offsetMs) ? 0 : this.offsetMs);
  }

  /** A new connection may reach a different server: start over. */
  reset(): void {
    this.#count = 0;
    this.#next = 0;
    this.offsetMs = Number.NaN;
    this.rttMs = Number.NaN;
  }
}
