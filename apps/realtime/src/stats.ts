import type { BoothStatsRow } from '@shipfair/shared';
import type { VisitSink } from './shard/visits.ts';

/** What `WebRpc.ingestStats` answers (apps/web/worker/realtime-rpc.ts). */
export type IngestResult =
  | { ok: true; written: number }
  | { ok: false; error: 'invalid' | 'forbidden' | 'unconfigured' };

const DAY_MS = 86_400_000;

/**
 * Pending visit counts and the "seen today" set, in the shard's own SQLite storage, so neither is
 * lost if the object is evicted between reports. Visits are rare (one per player per booth stay),
 * so this is a handful of local writes a minute, never a database call.
 */
export class VisitLedger implements VisitSink {
  readonly #sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.#sql = sql;
    sql.exec(`create table if not exists visit_seen (
      day text not null, player text not null, booth text not null,
      primary key (day, player, booth)
    ) without rowid`);
    sql.exec(`create table if not exists visit_pending (
      day text not null, booth text not null,
      visits integer not null, unique_visitors integer not null,
      primary key (day, booth)
    ) without rowid`);
  }

  record(day: string, playerKey: string, boothId: string): void {
    const seen = this.#sql.exec(
      'insert or ignore into visit_seen (day, player, booth) values (?, ?, ?)',
      day,
      playerKey,
      boothId,
    );
    const isFirst = seen.rowsWritten > 0 ? 1 : 0;
    this.#sql.exec(
      `insert into visit_pending (day, booth, visits, unique_visitors) values (?, ?, 1, ?)
       on conflict (day, booth) do update set
         visits = visits + 1, unique_visitors = unique_visitors + excluded.unique_visitors`,
      day,
      boothId,
      isFirst,
    );
  }

  /** Everything not yet reported. */
  pending(): BoothStatsRow[] {
    return this.#sql
      .exec<{ day: string; booth: string; visits: number; unique_visitors: number }>(
        'select day, booth, visits, unique_visitors from visit_pending order by day, booth',
      )
      .toArray()
      .map((r) => ({
        boothId: r.booth,
        day: r.day,
        visits: r.visits,
        uniqueVisitors: r.unique_visitors,
      }));
  }

  /** Takes reported rows off the pending counts (visits made during the call stay pending). */
  settle(rows: readonly BoothStatsRow[]): void {
    for (const row of rows) {
      this.#sql.exec(
        `update visit_pending set visits = visits - ?, unique_visitors = unique_visitors - ?
         where day = ? and booth = ?`,
        row.visits,
        row.uniqueVisitors,
        row.day,
        row.boothId,
      );
    }
    this.#sql.exec('delete from visit_pending where visits <= 0 and unique_visitors <= 0');
  }

  /** Forgets "seen" entries older than yesterday (UTC). */
  prune(nowMs: number): void {
    const yesterday = new Date(nowMs - DAY_MS).toISOString().slice(0, 10);
    this.#sql.exec('delete from visit_seen where day < ?', yesterday);
  }
}
