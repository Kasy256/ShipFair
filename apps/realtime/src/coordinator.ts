import { SHARD_FILL_RATIO, ShardId } from '@shipfair/shared';
import { Server } from 'partyserver';
import { readConfig } from './config.ts';
import type { Env } from './env.ts';
import { RESERVATION_MS, SHARD_TTL_MS } from './limits.ts';

// Assigns players to world shards (ARCHITECTURE.md §7 "Sharding"). One instance, `main`. Shards
// report their population every 10 s through `report` (a DO stub call, not an HTTP path). Every
// assignment also counts as an optimistic reservation for 15 s, so a burst of joins spreads out
// even while the shards are still busy letting the last ones in. State lives in the object's SQLite storage.

export interface ShardLoad {
  readonly name: string;
  /** Reported population plus every live (≤ 15 s old) reservation. */
  readonly load: number;
}

const shardNumber = (name: string): number => Number(name.slice(2));

/**
 * The shard for the next player: a requested shard if it isn't full, else the most-full shard
 * still under 90% (so people see each other), else a new `w-<n+1>`.
 */
export function pickShard(
  loads: readonly ShardLoad[],
  maxPlayers: number,
  requested?: string,
): string {
  if (requested !== undefined) {
    const load = loads.find((l) => l.name === requested)?.load ?? 0;
    if (load < maxPlayers) return requested;
  }
  const threshold = maxPlayers * SHARD_FILL_RATIO;
  let best: ShardLoad | null = null;
  for (const l of loads) {
    if (l.load >= threshold) continue;
    if (
      !best ||
      l.load > best.load ||
      (l.load === best.load && shardNumber(l.name) < shardNumber(best.name))
    ) {
      best = l;
    }
  }
  if (best) return best.name;
  const highest = loads.reduce((n, l) => Math.max(n, shardNumber(l.name)), 0);
  return `w-${highest + 1}`;
}

export interface ShardHealth {
  readonly name: string;
  readonly population: number;
  readonly reserved: number;
}

export interface Health {
  readonly ok: true;
  readonly shards: ShardHealth[];
  readonly totals: { readonly players: number; readonly shards: number };
}

const notFound = () =>
  Response.json({ error: { code: 'not_found', message: 'Route not found' } }, { status: 404 });

export class Coordinator extends Server<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(`create table if not exists shards (
      name text primary key, population integer not null, reported_at integer not null
    ) without rowid`);
    sql.exec(`create table if not exists reservations (
      shard text not null, created_at integer not null, expires_at integer not null
    )`);
  }

  #sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  /** Drops expired reservations and shards that stopped reporting. */
  #expire(nowMs: number): void {
    this.#sql().exec('delete from reservations where expires_at <= ?', nowMs);
    this.#sql().exec('delete from shards where reported_at <= ?', nowMs - SHARD_TTL_MS);
  }

  /** Live shards: reported within SHARD_TTL_MS or holding reservations. */
  #health(nowMs: number): ShardHealth[] {
    this.#expire(nowMs);
    const byName = new Map<string, { population: number; reportedAt: number; reserved: number }>();
    for (const row of this.#sql()
      .exec<{ name: string; population: number; reported_at: number }>(
        'select name, population, reported_at from shards',
      )
      .toArray()) {
      byName.set(row.name, {
        population: row.population,
        reportedAt: row.reported_at,
        reserved: 0,
      });
    }
    for (const row of this.#sql()
      .exec<{ shard: string; created_at: number }>('select shard, created_at from reservations')
      .toArray()) {
      const entry = byName.get(row.shard) ?? { population: 0, reportedAt: 0, reserved: 0 };
      // Counted for its whole 15 s even if a report came in meanwhile: a player who was sent here
      // may still be connecting, and leaving them out sends every joiner of a burst to the same
      // shard. Players who did connect count twice until then, which only opens shards early.
      entry.reserved++;
      byName.set(row.shard, entry);
    }
    return [...byName]
      .map(([name, e]) => ({ name, population: e.population, reserved: e.reserved }))
      .sort((a, b) => shardNumber(a.name) - shardNumber(b.name));
  }

  /**
   * Picks a shard and reserves a place in it. `requested` (from `?shard=`) is honoured unless it
   * is full; `exclude` is treated as full (a shard that just turned someone away).
   */
  assign(requested?: string, exclude?: string, nowMs = Date.now()): string {
    const { maxPlayers } = readConfig(this.env).limits;
    const loads: ShardLoad[] = this.#health(nowMs).map((s) => ({
      name: s.name,
      load: s.name === exclude ? Number.POSITIVE_INFINITY : s.population + s.reserved,
    }));
    if (exclude && !loads.some((l) => l.name === exclude)) {
      loads.push({ name: exclude, load: Number.POSITIVE_INFINITY });
    }
    const wanted = requested !== undefined && requested !== exclude ? requested : undefined;
    const shard = pickShard(loads, maxPlayers, wanted);
    this.#sql().exec(
      'insert into reservations (shard, created_at, expires_at) values (?, ?, ?)',
      shard,
      nowMs,
      nowMs + RESERVATION_MS,
    );
    return shard;
  }

  /** A shard's population report. Answers the total across live shards (for `notice:population`). */
  report(shard: string, population: number, nowMs = Date.now()): { total: number } {
    if (!ShardId.safeParse(shard).success || !(population >= 0))
      return { total: this.#total(nowMs) };
    this.#sql().exec(
      `insert into shards (name, population, reported_at) values (?, ?, ?)
       on conflict (name) do update set population = excluded.population, reported_at = excluded.reported_at`,
      shard,
      Math.floor(population),
      nowMs,
    );
    return { total: this.#total(nowMs) };
  }

  #total(nowMs: number): number {
    return this.#health(nowMs).reduce((sum, s) => sum + s.population, 0);
  }

  /** Shards that reported recently or hold reservations (for kicks and world updates). */
  liveShards(nowMs = Date.now()): string[] {
    return this.#health(nowMs).map((s) => s.name);
  }

  health(nowMs = Date.now()): Health {
    const shards = this.#health(nowMs);
    return {
      ok: true,
      shards,
      totals: { players: shards.reduce((sum, s) => sum + s.population, 0), shards: shards.length },
    };
  }

  // `GET /parties/coordinator/main/join?shard=<optional>` is the only public path (index.ts
  // refuses every other one before it gets here).
  override onRequest(request: Request): Response {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.pathname.endsWith('/join')) return notFound();
    const asked = url.searchParams.get('shard');
    const requested = asked !== null && ShardId.safeParse(asked).success ? asked : undefined;
    return Response.json(
      { shard: this.assign(requested) },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  override onConnect(connection: { close(code?: number, reason?: string): void }): void {
    connection.close(1008, 'The coordinator takes no sockets');
  }
}
