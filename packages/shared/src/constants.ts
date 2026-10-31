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
export const DISTRICT_SPAWN_INSET_M = 4; // district teleports land this far inside the gate
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

// Booth submission (prompt 08, TRUST_AND_SAFETY.md "Booths"). _B is bytes, _PX pixels.
export const BOOTHS_PER_USER_MAX = 3; // every status except archived
export const PENDING_BOOTHS_PER_USER_MAX = 1;
export const MIN_ACCOUNT_AGE_MINUTES = 60; // default; the Worker var overrides it (0 locally)
export const UPLOAD_INPUT_MAX_B = 10 * 1024 * 1024; // the file picked, before resizing
export const UPLOAD_LOGO_MAX_B = 300 * 1024; // WebP as uploaded
export const UPLOAD_SCREENSHOT_MAX_B = 600 * 1024;
export const UPLOAD_URL_TTL_S = 300; // presigned PUT lifetime
export const UPLOAD_PENDING_PREFIX = 'pending/'; // private until a moderator approves
export const LOGO_PX = 512; // square
export const LOGO_MIN_PX = 256; // smallest source a logo may come from
export const SCREENSHOT_MAX_W_PX = 1280;
export const SCREENSHOT_MIN_W_PX = 640;
export const WEBP_QUALITY = 0.85;
export const URL_CHECK_TIMEOUT_MS = 5000;
export const URL_CHECK_MAX_REDIRECTS = 3;
export const DRAFT_AUTOSAVE_MS = 5000;

// Staff tools (prompt 09, TRUST_AND_SAFETY.md "Staff tools")
export const REJECT_NOTE_MAX_CHARS = 300;
export const BAN_REASON_MAX_CHARS = 300;
export const FLAG_MINUTES_MAX = 7 * 24 * 60; // a week; minute-valued feature flags stop here
export const FLAG_CACHE_S = 30; // the web Worker re-reads flags at most this often
export const ADMIN_PAGE_SIZE = 20; // rows per page on /api/admin list endpoints
export const ADMIN_SEARCH_MAX_CHARS = 20; // handle search

// World snapshot edge cache (INFRASTRUCTURE.md §6)
export const WORLD_CACHE_MAX_AGE_S = 30;
export const WORLD_CACHE_STALE_S = 300; // stale-while-revalidate window after max-age
export const SHARE_PANEL_DELAY_S = 1.5; // /b/:slug opens the booth panel this long after entering

// Art (prompt 04b): written by `pnpm assets:build`, read by the engine and the avatar editor.
export const ASSET_MANIFEST_URL = '/assets/assets-manifest.generated.json';

// Protocol versioning (CODING_STANDARDS.md §6)
export const PROTOCOL_VERSION = 1;
export const MIN_CLIENT_PROTOCOL = 1;
