// Client-only tunables (CODING_STANDARDS.md §1). Shared ones (walk/run speeds) live in
// @shipfair/shared constants. Units are in the names: _M metres, _S seconds, _MPS metres per
// second, _MPS2 metres per second², _RAD radians, _HZ per second, _PX CSS pixels, _MS milliseconds.

// Loop (CODING_STANDARDS.md §4)
export const FIXED_HZ = 60;
export const FIXED_DT_S = 1 / FIXED_HZ;
export const MAX_SUBSTEPS = 5;
/** A frame longer than this (tab switch, debugger) is clamped so physics never spirals. */
export const MAX_FRAME_S = 0.25;

// Character capsule and Rapier character controller (prompt 04, KICKOFF_NOTES risk 5)
export const CAPSULE_RADIUS_M = 0.3;
export const CAPSULE_HALF_HEIGHT_M = 0.6; // cylinder segment 1.2 m, total height 1.8 m
export const PLAYER_HEIGHT_M = 2 * (CAPSULE_HALF_HEIGHT_M + CAPSULE_RADIUS_M);
export const KCC_OFFSET_M = 0.01; // skin gap Rapier keeps between the capsule and the world
/**
 * Rapier's push-out along contact normals (its default is 1e-4). At the default, about 1 in 100
 * long wall slides sank 4–6 cm into the wall and stayed there; at 0.01 none did in 300 runs.
 */
export const KCC_NORMAL_NUDGE = 0.01;
export const STEP_HEIGHT_M = 0.45;
export const STEP_MIN_WIDTH_M = 0.2;
export const MAX_SLOPE_RAD = (45 * Math.PI) / 180;
export const SNAP_TO_GROUND_M = 0.3;

// Movement feel, ported from the prototype's player.js
export const GRAVITY_MPS2 = 24;
export const JUMP_SPEED_MPS = 7.6; // apex v²/2g ≈ 1.203 m, airtime 2v/g ≈ 0.633 s
export const GROUND_ACCEL_HZ = 14;
export const AIR_ACCEL_HZ = 7;
export const TURN_RATE_HZ = 12;
/** Below this, the player is treated as standing still (no turning, idle pose). */
export const MOVE_EPSILON_MPS = 0.05;
/**
 * A stick pushed past its deadzone never asks for less than this share of walk speed (1.3 m/s).
 * Slower, the capsule can't climb 0.3 m stairs once KCC_NORMAL_NUDGE is at 0.01.
 */
export const MIN_ANALOG_SPEED_RATIO = 0.5;
/** Falling below this y resets the player to the spawn (safety net for holes in the level). */
export const KILL_Y_M = -20;

// Animation (procedural avatar)
export const STEP_EVENT_MIN_SPEED_MPS = 0.4;
export const LAND_SQUASH_S = 0.18;
export const LAND_MIN_AIRTIME_S = 0.25;
export const WAVE_DURATION_S = 1.6;
export const STEP_UP_SMOOTH_HZ = 18;

// Camera (prompt 04 §8, prototype updateCamera)
export const CAMERA_FOV_DEG = 62;
export const CAMERA_NEAR_M = 0.1;
export const CAMERA_FAR_M = 2000;
export const CAMERA_TARGET_HEIGHT_M = 1.55;
export const CAMERA_TARGET_FOLLOW_HZ = 14;
export const CAMERA_TARGET_SNAP_M = 6;
export const CAMERA_SHOULDER_M = 0.35;
export const CAMERA_SIDE_MARGIN_M = 0.2;
export const CAMERA_WALL_MARGIN_M = 0.25;
/** Never closer to a hit surface than this, even when the margin would put the camera nearer. */
export const CAMERA_MIN_CLEARANCE_M = 0.05;
export const CAMERA_MIN_DIST_M = 0.6;
export const CAMERA_EASE_OUT_HZ = 3;
export const CAMERA_ZOOM_MIN_M = 1.6;
export const CAMERA_ZOOM_MAX_M = 10;
export const CAMERA_ZOOM_DEFAULT_M = 4.6;
export const CAMERA_PITCH_MIN_RAD = -0.35;
export const CAMERA_PITCH_MAX_RAD = 1.2;
export const CAMERA_PITCH_DEFAULT_RAD = 0.22;

// Input
export const MOUSE_YAW_RAD_PER_PX = 0.0032;
export const MOUSE_PITCH_RAD_PER_PX = 0.0028;
export const WHEEL_ZOOM_M_PER_PX = 0.004;
export const TOUCH_LOOK_RAD_PER_PX = 0.006;
export const JOYSTICK_RADIUS_PX = 56;
export const JOYSTICK_DEADZONE = 0.12;
/** Pushing the stick past this share of its radius runs. */
export const JOYSTICK_RUN_AT = 0.92;
export const GAMEPAD_DEADZONE = 0.18;
export const GAMEPAD_LOOK_RAD_PER_S = 2.6;

// Rendering
export const PIXEL_RATIO_CAP = { high: 1.5, low: 1 } as const;
export const TONE_MAPPING_EXPOSURE = 0.9;
export const BLOOM_STRENGTH = 0.5;
export const BLOOM_RADIUS = 0.45;
export const BLOOM_THRESHOLD = 1.1;
export const SHADOW_MAP_PX = 2048;
export const SHADOW_EXTENT_M = 32;

// Quality detection and adaptive controller (ARCHITECTURE.md §4)
export const BENCHMARK_FRAMES = 60;
/** A boot benchmark slower than this per frame (≈ 40 fps) drops `high` to `low`. */
export const BENCHMARK_LOW_MS = 25;
export const LOW_TIER_MAX_SCREEN_PX = 820; // the shorter screen side, in CSS px
export const LOW_TIER_MAX_CORES = 2; // at or below this many logical cores
export const LOW_TIER_MAX_MEMORY_GB = 4; // below this much device memory
export const TARGET_FPS = { high: 60, low: 30 } as const;
/** The 3-second average must stay below target × this before quality steps down. */
export const ADAPT_DOWN_RATIO = 0.9;
/** … and above target × this for ADAPT_UP_S before it steps back up (never past the chosen tier). */
export const ADAPT_UP_RATIO = 0.97;
export const ADAPT_WINDOW_S = 3;
export const ADAPT_UP_S = 10;
export const PERF_SAMPLE_S = 1;
export const RENDER_SCALES = [1, 0.75, 0.6] as const;

// Art assets (prompt 04b, ARCHITECTURE.md §4)
export const ASSET_MANIFEST_URL = '/assets/assets-manifest.generated.json';

// Character LOD policy for remote players (used by prompt 11). Nearest by distance get LOD0, the
// next ones within LOD1_MAX_DISTANCE_M get LOD1, everyone else the instanced stand-in.
export const LOD0_COUNT = { high: 6, low: 3 } as const;
export const LOD1_COUNT = { high: 12, low: 6 } as const;
export const LOD1_MAX_DISTANCE_M = 25;
/** A player already at a LOD keeps it until a rival is this much closer (or it moves this far out). */
export const LOD_HYSTERESIS_M = 2;
export const LOD_SWAP_FADE_S = 0.2;
export const LOD_REEVALUATE_S = 0.25;
/** Mixers tick every frame at LOD0, every Nth frame at LOD1; stand-ins have none. */
export const LOD1_ANIMATION_EVERY = 2;

// Character animation (glTF clips)
export const ANIM_CROSSFADE_S = 0.2;
/** Seconds of `jump_land` shown before locomotion takes over (the clip itself is longer). */
export const ANIM_LAND_S = 0.35;
/** Below this speed the locomotion blend is pure idle. */
export const ANIM_IDLE_MPS = 0.15;
/** Seconds of `jump_start` before `jump_air` (the clip is longer than a jump's rise). */
export const ANIM_JUMP_START_S = 0.2;

/**
 * Booths and props farther than this from the camera aren't drawn (re-checked every
 * LOD_REEVALUATE_S). One instanced mesh spans the whole city, so frustum culling alone can't
 * keep the low tier inside its triangle budget.
 */
export const DRAW_DISTANCE_M = { high: Number.POSITIVE_INFINITY, low: 120 } as const;
