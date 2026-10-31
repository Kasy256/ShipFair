// Per-shard counters, logged as one JSON line every METRICS_MS (ARCHITECTURE.md §7). The load
// test parses these lines. Tick durations go into a fixed ring, so recording allocates nothing.

const TICK_SAMPLES = 1024; // > 60 s at 10 Hz

export interface MetricsReport {
  readonly shard: string;
  readonly players: number;
  readonly msgsIn: number;
  readonly msgsOut: number;
  readonly bytesOut: number;
  readonly snaps: number;
  /** Average snap entries (players) per snap. */
  readonly snapEntriesAvg: number;
  /** Average bytes per player entry in a snap (frame bytes / entries). */
  readonly snapBytesPerPlayer: number;
  readonly ticks: number;
  readonly tickP50Ms: number;
  readonly tickP95Ms: number;
  readonly tickMaxMs: number;
  readonly invalid: number;
  readonly dropped: number;
  readonly clamped: number;
  readonly periodS: number;
}

function percentile(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, i)] ?? 0;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export class ShardMetrics {
  msgsIn = 0;
  msgsOut = 0;
  bytesOut = 0;
  snaps = 0;
  snapEntries = 0;
  snapBytes = 0;
  invalid = 0;
  /** Messages refused by a rate limit or sent before hello. */
  dropped = 0;
  /** Moves corrected (too fast or out of bounds). */
  clamped = 0;
  readonly #ticks = new Float64Array(TICK_SAMPLES);
  #tickCount = 0;
  #sinceMs: number;

  constructor(nowMs: number) {
    this.#sinceMs = nowMs;
  }

  recordTick(ms: number): void {
    this.#ticks[this.#tickCount % TICK_SAMPLES] = ms;
    this.#tickCount++;
  }

  recordSend(bytes: number): void {
    this.msgsOut++;
    this.bytesOut += bytes;
  }

  recordSnap(entries: number, bytes: number): void {
    this.snaps++;
    this.snapEntries += entries;
    this.snapBytes += bytes;
  }

  /** The report for the period since the last one, then resets every counter. */
  take(shard: string, players: number, nowMs: number): MetricsReport {
    const n = Math.min(this.#tickCount, TICK_SAMPLES);
    const sorted = this.#ticks.slice(0, n).sort();
    const report: MetricsReport = {
      shard,
      players,
      msgsIn: this.msgsIn,
      msgsOut: this.msgsOut,
      bytesOut: this.bytesOut,
      snaps: this.snaps,
      snapEntriesAvg: this.snaps > 0 ? round3(this.snapEntries / this.snaps) : 0,
      snapBytesPerPlayer: this.snapEntries > 0 ? round3(this.snapBytes / this.snapEntries) : 0,
      ticks: this.#tickCount,
      tickP50Ms: round3(percentile(sorted, 0.5)),
      tickP95Ms: round3(percentile(sorted, 0.95)),
      tickMaxMs: round3(n > 0 ? (sorted[n - 1] ?? 0) : 0),
      invalid: this.invalid,
      dropped: this.dropped,
      clamped: this.clamped,
      periodS: round3((nowMs - this.#sinceMs) / 1000),
    };
    this.msgsIn = 0;
    this.msgsOut = 0;
    this.bytesOut = 0;
    this.snaps = 0;
    this.snapEntries = 0;
    this.snapBytes = 0;
    this.invalid = 0;
    this.dropped = 0;
    this.clamped = 0;
    this.#tickCount = 0;
    this.#sinceMs = nowMs;
    return report;
  }
}
