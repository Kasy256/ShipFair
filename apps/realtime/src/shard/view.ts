import { encodeSnap, type ServerMessage } from '@shipfair/shared';
import type { AoiGrid } from './aoi-grid.ts';
import type { Player } from './player.ts';

// What each player sees, computed once per tick (ARCHITECTURE.md §7): joins for players that came
// within the AOI radius, leaves for those beyond it plus a 10% hysteresis band (so nobody flickers
// at the edge), and one `snap` with only the players that changed since this recipient's last one.
// Each player's snap entry is packed once per change (`Player.entryBytes`), not per recipient.
// Pure apart from `sink`, so tools/loadtest/tick-bench.ts can time it outside workerd.

/** A player joins your view inside the AOI radius and leaves it beyond this factor of it. */
export const AOI_LEAVE_FACTOR = 1.1;

export interface ViewSink {
  /** Encodes and sends one frame; returns its size in bytes. */
  send(to: Player, msg: ServerMessage): number;
  /** Sends an already encoded frame. */
  sendBytes(to: Player, bytes: Uint8Array): void;
  /** Called once per snap sent, for the metrics. */
  snapSent(entries: number, bytes: number): void;
}

export const horizontalDistSq = (a: Player, b: Player): number => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
};

/** Rebuilds the grid from `players` and sends every player its view for this tick. */
export function stepViews(
  players: Iterable<Player>,
  grid: AoiGrid<Player>,
  aoiRadiusM: number,
  now: number,
  sink: ViewSink,
): void {
  grid.clear();
  for (const player of players) grid.insert(player);
  for (const player of players) sendView(player, grid, aoiRadiusM, now, sink);
}

/** Joins, leaves and one `snap` of changed players for one recipient. */
export function sendView(
  me: Player,
  grid: AoiGrid<Player>,
  aoiRadiusM: number,
  now: number,
  sink: ViewSink,
): void {
  const enterSq = aoiRadiusM * aoiRadiusM;
  const seen = new Set<number>();
  const entries: Uint8Array[] = [];
  grid.forEachWithin(me.x, me.z, aoiRadiusM * AOI_LEAVE_FACTOR, (other) => {
    if (other === me) return;
    if (!me.aoi.has(other.id)) {
      if (horizontalDistSq(me, other) > enterSq) return;
      me.aoi.add(other.id);
      me.sent.set(other.id, other.version);
      seen.add(other.id);
      sink.send(me, { type: 'join', player: other.summary() });
      return;
    }
    seen.add(other.id);
    if (me.sent.get(other.id) === other.version) return;
    me.sent.set(other.id, other.version);
    entries.push(other.entryBytes());
  });
  for (const id of me.aoi) {
    if (seen.has(id)) continue;
    me.aoi.delete(id);
    me.sent.delete(id);
    sink.send(me, { type: 'leave', id });
  }
  if (entries.length > 0) {
    const bytes = encodeSnap(now, entries);
    sink.sendBytes(me, bytes);
    sink.snapSent(entries.length, bytes.byteLength);
  }
}
