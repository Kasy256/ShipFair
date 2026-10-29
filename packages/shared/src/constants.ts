// Shared tunables. Units are in the names: _M metres, _S seconds, _MS milliseconds, _HZ per second,
// _MPS metres per second, _CM centimetres. Client-only tunables live in packages/engine/src/config.ts.

// City layout (ARCHITECTURE.md §4)
export const LOT_W_M = 10; // lot frontage along its street
export const LOT_D_M = 8; // lot depth away from its street
export const STREET_W_M = 6;
export const LOTS_PER_STREET_SIDE = 6; // a street has a row of lots on each side
export const DISTRICT_INITIAL_STREETS = 1;
export const DISTRICT_GROW_AT = 0.8; // add a street once this share of lots is taken
export const DISTRICT_GAP_M = 6; // between neighbouring districts on the same side of the plaza
export const PLAZA_SIZE_M = 60; // square, centred on the origin
export const SPAWN_DISTANCE_M = 5; // in front of a booth for /b/:slug deep links
export const BOOTH_GRID_CELL_M = 8; // spatial grid cell for nearestBooth

// Movement (ARCHITECTURE.md §7 trust model)
export const MAX_SPEED_MPS = 8; // server clamp
export const RUN_SPEED_MPS = 6;
export const WALK_SPEED_MPS = 2.6;
export const MOVE_SLACK_M = 0.5; // absorbs network bunching when clamping
export const CLIENT_MAX_MSG_PER_S = 12;

// Network rates and interpolation
export const SNAPSHOT_HZ = 10;
export const CLIENT_SEND_HZ = 10;
export const IDLE_HEARTBEAT_HZ = 1;
export const PING_HZ = 0.2;
export const INTERP_DELAY_MS = 180; // ~2 snapshot intervals plus margin
export const EXTRAP_MAX_MS = 250;
export const MAX_CLIENT_MSG_BYTES = 2048; // decodeClient rejects larger frames before parsing

// Shards and areas of interest
export const AOI_RADIUS_M = 60;
export const CHAT_RADIUS_M = 15;
export const MAX_PLAYERS_PER_SHARD = 60;
export const SHARD_FILL_RATIO = 0.9;

// Chat and guestbook (TRUST_AND_SAFETY.md)
export const CHAT_MAX_CHARS = 160;
export const CHAT_BURST = 3;
export const CHAT_INTERVAL_S = 1.5;
export const EMOTE_PER_S = 1;
export const TELEPORT_PER_S = 1;
export const GUESTBOOK_MAX_CHARS = 200;
export const REPORT_NOTE_MAX_CHARS = 300;

// Booths
export const BOOTH_FOCUS_RADIUS_M = 3;
export const BOOTH_VISIT_RADIUS_M = 6;
export const BOOTH_VISIT_MIN_S = 5;
export const TEXTURE_STREAM_RADIUS_M = 35;
export const BOOTH_MEDIA_MAX = 5;
export const BOOTH_TIER_VISITORS = 250; // sum of daily unique visitors for the `booth` tier
export const PAVILION_TOP_N = 10; // by weekly unique visitors

// World snapshot edge cache (INFRASTRUCTURE.md §6)
export const WORLD_CACHE_MAX_AGE_S = 30;
export const WORLD_CACHE_STALE_S = 300; // stale-while-revalidate window after max-age
export const SHARE_PANEL_DELAY_S = 1.5; // /b/:slug opens the booth panel this long after entering

// Protocol versioning (CODING_STANDARDS.md §6)
export const PROTOCOL_VERSION = 1;
export const MIN_CLIENT_PROTOCOL = 1;
