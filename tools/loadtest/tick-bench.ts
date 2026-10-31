import { parseArgs } from 'node:util';
import {
  BOOTH_VISIT_RADIUS_M,
  DEFAULT_AVATAR_STYLE,
  encodeServer,
  layoutCity,
  nearestBooth,
  rng,
  toNetPos,
} from '@shipfair/shared';
import { fakeWorld } from '@shipfair/shared/fake-world';
import { AOI_CELL_M } from '../../apps/realtime/src/limits.ts';
import { AoiGrid } from '../../apps/realtime/src/shard/aoi-grid.ts';
import { Player, type PlayerState } from '../../apps/realtime/src/shard/player.ts';
import { stepViews, type ViewSink } from '../../apps/realtime/src/shard/view.ts';

// CPU cost of one shard tick, outside workerd: the same grid, view and encoding code the shard
// runs (apps/realtime/src/shard), on V8 like workerd, minus the socket writes. Every player moves
// every tick, the worst case. Two layouts: "dense" (everyone inside one AOI) and "city" (spread
// over the fake city's bounds).
//
//   node tools/loadtest/tick-bench.ts --players 60 --ticks 3000

const { values: args } = parseArgs({
  options: {
    players: { type: 'string', default: '60' },
    ticks: { type: 'string', default: '3000' },
  },
});
const PLAYERS = Number(args.players);
const TICKS = Number(args.ticks);
const WARMUP = 300;
const STEP_M = 0.45; // 4.5 m/s at 10 Hz

const world = fakeWorld(60, 7);
const layout = layoutCity(world.districts, world.booths);
const avatar = DEFAULT_AVATAR_STYLE;
const fakeConn = { id: '', state: null, isOpen: true, setState() {}, send() {}, close() {} };

function makePlayer(id: number, x: number, z: number): Player {
  const state: PlayerState = {
    kind: 'player',
    id,
    name: `Bot ${id}`,
    isGuest: true,
    key: `guest:${id}`,
    avatar,
    createdMs: 0,
    p: [toNetPos(x), 0, toNetPos(z)],
    r: 0,
    a: 2,
    movedAt: 0,
    isPlaced: true,
    buckets: null,
    mutedUntil: 0,
    strikes: [],
  };
  return new Player({ ...fakeConn, id: `c${id}` }, state);
}

function percentile(sorted: Float64Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
}

function run(name: string, area: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const random = rng(42);
  const players = Array.from({ length: PLAYERS }, (_, i) =>
    makePlayer(
      i + 1,
      area.minX + random() * (area.maxX - area.minX),
      area.minZ + random() * (area.maxZ - area.minZ),
    ),
  );
  const headings = players.map(() => random() * Math.PI * 2);
  const grid = new AoiGrid<Player>(AOI_CELL_M);
  let bytes = 0;
  let snaps = 0;
  let entries = 0;
  let snapBytes = 0;
  const sink: ViewSink = {
    send(_to, msg) {
      const size = encodeServer(msg).byteLength;
      bytes += size;
      return size;
    },
    sendBytes(_to, frame) {
      bytes += frame.byteLength;
    },
    snapSent(n, size) {
      snaps++;
      entries += n;
      snapBytes += size;
    },
  };
  const times = new Float64Array(TICKS);
  for (let t = 0; t < WARMUP + TICKS; t++) {
    // Walk everyone (bouncing off the area's edges); this happens in onMessage, not the tick.
    for (const [i, p] of players.entries()) {
      let h = headings[i] ?? 0;
      let x = p.x + Math.sin(h) * STEP_M;
      let z = p.z + Math.cos(h) * STEP_M;
      if (x < area.minX || x > area.maxX || z < area.minZ || z > area.maxZ) {
        h += Math.PI;
        headings[i] = h;
        x = p.x;
        z = p.z;
      }
      p.state.p = [toNetPos(x), 0, toNetPos(z)];
      p.version++;
      p.syncMetres();
    }
    const started = performance.now();
    stepViews(players, grid, 60, t * 100, sink);
    for (const p of players) nearestBooth(layout, p.x, p.z, BOOTH_VISIT_RADIUS_M);
    const ms = performance.now() - started;
    if (t >= WARMUP) times[t - WARMUP] = ms;
    if (t === WARMUP - 1) {
      bytes = 0;
      snaps = 0;
      entries = 0;
      snapBytes = 0;
    }
  }
  times.sort();
  console.log(
    JSON.stringify({
      scenario: name,
      players: PLAYERS,
      ticks: TICKS,
      tickP50Ms: Math.round(percentile(times, 0.5) * 1000) / 1000,
      tickP95Ms: Math.round(percentile(times, 0.95) * 1000) / 1000,
      tickMaxMs: Math.round((times[times.length - 1] ?? 0) * 1000) / 1000,
      avgEntriesPerSnap: Math.round((entries / Math.max(1, snaps)) * 10) / 10,
      avgSnapBytesPerPlayer: Math.round((snapBytes / Math.max(1, entries)) * 100) / 100,
      bytesOutPerTick: Math.round(bytes / TICKS),
    }),
  );
}

run('dense', { minX: -25, maxX: 25, minZ: -25, maxZ: 25 });
run('city', layout.bounds);
