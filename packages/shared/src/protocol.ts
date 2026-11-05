import * as z from 'zod';
import {
  AVATAR_MAX_BYTES,
  BOOTHS_PER_USER_MAX,
  CHAT_MAX_CHARS,
  MIN_CLIENT_PROTOCOL,
  PROTOCOL_VERSION,
} from './constants.ts';
import { AvatarStyle, AvatarStyleV2 } from './schemas/avatar.ts';
import { Slug, Uuid } from './schemas/common.ts';

// Realtime wire protocol (ARCHITECTURE.md §7). Positions travel as integer centimetres and yaw as
// a uint16 turn fraction; convert only with the helpers below.

const CM_PER_M = 100;
const TAU = 2 * Math.PI;
const YAW_STEPS = 65536;
const NET_POS_MAX_CM = 10_000_000; // ±100 km, far outside any city
const MAX_SNAP_ENTRIES = 1024;
const TOKEN_MAX_CHARS = 8192;
const NOTICE_MAX_CHARS = 200;

// --- unit conversion -------------------------------------------------------------------------

// `|| 0` turns −0 into 0, which msgpack would otherwise send as a 9-byte float.
export const toNetPos = (metres: number): number => Math.round(metres * CM_PER_M) || 0;
export const fromNetPos = (cm: number): number => cm / CM_PER_M;

/** Radians (any range) → uint16, where 65536 steps make one full turn. */
export function toNetYaw(rad: number): number {
  const turns = rad / TAU;
  return Math.round((turns - Math.floor(turns)) * YAW_STEPS) & (YAW_STEPS - 1);
}

/** uint16 → radians in [0, 2π). */
export const fromNetYaw = (yaw: number): number => (yaw / YAW_STEPS) * TAU;

export const isProtocolSupported = (v: number): boolean =>
  v >= MIN_CLIENT_PROTOCOL && v <= PROTOCOL_VERSION;

// --- field schemas ---------------------------------------------------------------------------

/** Shard-local player id, assigned by the shard on `hello`. Keeps `snap` entries small. */
export const NetId = z
  .int()
  .min(0)
  .max(YAW_STEPS - 1);
const Cm = z.int().min(-NET_POS_MAX_CM).max(NET_POS_MAX_CM);
export const NetPos = z.tuple([Cm, Cm, Cm]);
export const NetYaw = z
  .int()
  .min(0)
  .max(YAW_STEPS - 1);
const Uint8 = z.int().min(0).max(255);
const TimeMs = z.int().nonnegative();
export const ShardId = z.string().regex(/^w-\d{1,4}$/);
const PlayerName = z.string().min(1).max(32);

/**
 * The `a` field of `move` and `snap`: what the body is doing, so remote players animate without
 * guessing from speed alone. Emotes travel separately (`emote`).
 */
export const NET_ANIM = { idle: 0, walk: 1, run: 2, air: 3 } as const;
export type NetAnim = (typeof NET_ANIM)[keyof typeof NET_ANIM];

/**
 * The look in `hello`: v2 (protocol v2), or a v1 look from a protocol-v1 client, which the shard
 * migrates. At most AVATAR_MAX_BYTES as JSON.
 */
export const HelloAvatar = z
  .union([AvatarStyleV2, AvatarStyle])
  .refine((style) => JSON.stringify(style).length <= AVATAR_MAX_BYTES, {
    message: `avatar is over ${AVATAR_MAX_BYTES} bytes`,
  });
export type HelloAvatar = z.infer<typeof HelloAvatar>;

export const Teleport = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('booth'), slug: Slug }),
  z.object({ kind: z.literal('district'), slug: Slug }),
]);
export type Teleport = z.infer<typeof Teleport>;

/**
 * Where a `teleport` message goes: a booth or district (the UI's `Teleport`), or next to another
 * player in the shard (protocol v3, the booth panel's "Walk to maker").
 */
export const TeleportTarget = z.discriminatedUnion('kind', [
  ...Teleport.options,
  z.object({ kind: z.literal('player'), id: NetId }),
]);
export type TeleportTarget = z.infer<typeof TeleportTarget>;

export const PlayerSummary = z.object({
  id: NetId,
  name: PlayerName,
  isGuest: z.boolean(),
  /** Profile id for signed-in players (powers "Maker is here"); absent for guests. */
  uid: Uuid.optional(),
  /** Live booths this player owns (protocol v3; absent when none). Powers "Maker is here". */
  isMakerOf: z.array(Uuid).max(BOOTHS_PER_USER_MAX).optional(),
  avatar: AvatarStyleV2,
  p: NetPos,
  r: NetYaw,
  a: Uint8,
});
export type PlayerSummary = z.infer<typeof PlayerSummary>;

/** `[id, x, y, z, r, a]`, positions in cm. */
export const SnapEntry = z.tuple([NetId, Cm, Cm, Cm, NetYaw, Uint8]);
export type SnapEntry = z.infer<typeof SnapEntry>;

// --- client → server -------------------------------------------------------------------------

export const ClientMessage = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('hello'),
      v: z.int().nonnegative(),
      token: z.string().min(1).max(TOKEN_MAX_CHARS).optional(),
      guestId: Uuid.optional(),
      avatar: HelloAvatar,
    })
    .refine((m) => m.token !== undefined || m.guestId !== undefined, {
      message: 'hello needs a token or a guestId',
    }),
  z.object({ type: z.literal('move'), p: NetPos, r: NetYaw, a: Uint8, t: TimeMs }),
  z.object({ type: z.literal('emote'), e: Uint8 }),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(CHAT_MAX_CHARS) }),
  z.object({ type: z.literal('teleport'), to: TeleportTarget }),
  /** Protocol v3: stop (or start again) relaying this player's chat to the sender. */
  z.object({ type: z.literal('mute'), id: NetId }),
  z.object({ type: z.literal('unmute'), id: NetId }),
  z.object({ type: z.literal('ping'), t: TimeMs }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// --- server → client -------------------------------------------------------------------------

const noticeBase = { type: z.literal('notice'), message: z.string().max(NOTICE_MAX_CHARS) };

export const Notice = z.discriminatedUnion('code', [
  z.object({ ...noticeBase, code: z.literal('correct'), data: z.object({ p: NetPos, r: NetYaw }) }),
  z.object({ ...noticeBase, code: z.literal('shard_full'), data: z.object({ shard: ShardId }) }),
  z.object({ ...noticeBase, code: z.literal('update_required') }),
  z.object({ ...noticeBase, code: z.literal('banned') }),
  z.object({ ...noticeBase, code: z.literal('kicked') }),
  z.object({ ...noticeBase, code: z.literal('muted'), data: z.object({ until: TimeMs }) }),
  z.object({
    ...noticeBase,
    code: z.literal('world_update'),
    data: z.object({ boothIds: z.array(Uuid).max(MAX_SNAP_ENTRIES) }),
  }),
  z.object({
    ...noticeBase,
    code: z.literal('population'),
    data: z.object({ shard: z.int().nonnegative(), total: z.int().nonnegative() }),
  }),
]);
export type Notice = z.infer<typeof Notice>;
export type NoticeCode = Notice['code'];

export const ServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    you: NetId,
    shard: ShardId,
    players: z.array(PlayerSummary).max(MAX_SNAP_ENTRIES),
  }),
  /** `t` is server time in ms; clients interpolate on it, `INTERP_DELAY_MS` in the past. */
  z.object({ type: z.literal('snap'), t: TimeMs, s: z.array(SnapEntry).max(MAX_SNAP_ENTRIES) }),
  z.object({ type: z.literal('join'), player: PlayerSummary }),
  z.object({ type: z.literal('leave'), id: NetId }),
  z.object({ type: z.literal('emote'), id: NetId, e: Uint8 }),
  z.object({
    type: z.literal('chat'),
    id: NetId,
    text: z.string().min(1).max(CHAT_MAX_CHARS),
    ts: TimeMs,
  }),
  z.object({ type: z.literal('pong'), t: TimeMs }),
  Notice,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
