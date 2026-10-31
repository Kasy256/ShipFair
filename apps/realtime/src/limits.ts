import { SNAPSHOT_HZ } from '@shipfair/shared';

// Server-only tunables (ARCHITECTURE.md §7). Shared ones (speeds, radii, rates) live in
// packages/shared/src/constants.ts. Units are in the names, as there. No Worker types here, so the
// pure shard modules (and tools/loadtest/tick-bench.ts) can use them anywhere.

export const TICK_MS = 1000 / SNAPSHOT_HZ;
export const MOVE_BURST = 15; // token bucket capacity for moves (refill CLIENT_MAX_MSG_PER_S)
export const MOVE_SPEED_FACTOR = 1.25; // speed slack on top of MAX_SPEED_MPS
export const BOUNDS_MARGIN_M = 5; // beyond the outermost district or plaza edge
export const MIN_Y_M = -5;
export const MAX_Y_M = 50;
export const AOI_CELL_M = 20; // uniform grid for AOI queries, rebuilt every tick

export const HELLO_TIMEOUT_MS = 10_000; // a socket that hasn't said hello by then is closed
export const INVALID_LIMIT = 20; // invalid messages within the window close the socket
export const INVALID_WINDOW_MS = 10_000;

export const CHAT_STRIKES = 3; // filtered messages within the window mean a mute
export const CHAT_STRIKE_WINDOW_MS = 5 * 60_000;
export const CHAT_MUTE_MS = 10 * 60_000;

export const RESERVATION_MS = 15_000; // a coordinator assignment counts as a player this long
export const REPORT_MS = 10_000; // shard → coordinator population report
export const SHARD_TTL_MS = 30_000; // a shard with no report for this long is forgotten
export const POPULATION_PUSH_MS = 30_000; // notice:population to every player
export const STATS_FLUSH_MS = 60_000; // one ingestStats call per shard at most this often
export const WORLD_REFRESH_MS = 60_000;
export const METRICS_MS = 60_000;
export const FLAGS_REFRESH_MS = 30_000;
export const JWKS_CACHE_MS = 10 * 60_000;
export const PROFILE_CACHE_MS = 5 * 60_000;
export const WORLD_LOAD_TIMEOUT_MS = 3000; // hello waits this long for a first world load

/** WebSocket close codes we send (4000–4999 are free for applications). */
export const CLOSE = {
  updateRequired: 4000,
  shardFull: 4001,
  unsupported: 4002,
  banned: 4003,
  kicked: 4004,
  invalid: 4005,
  unauthorized: 4401,
  helloTimeout: 4408,
} as const;
