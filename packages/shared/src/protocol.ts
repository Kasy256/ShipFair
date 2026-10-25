import { Packr } from 'msgpackr';
import * as z from 'zod';
import {
  CHAT_MAX_CHARS,
  MAX_CLIENT_MSG_BYTES,
  MIN_CLIENT_PROTOCOL,
  PROTOCOL_VERSION,
} from './constants.ts';
import { err, ok, type Result } from './result.ts';
import { Slug, Uuid } from './schemas/common.ts';
import { AvatarStyle } from './schemas/profile.ts';

// Realtime wire protocol (ARCHITECTURE.md §7). Positions travel as integer centimetres and yaw as
// a uint16 turn fraction; convert only with the helpers below.

const CM_PER_M = 100;
const TAU = 2 * Math.PI;
const YAW_STEPS = 65536;
const NET_POS_MAX_CM = 10_000_000; // ±100 km, far outside any city
const MAX_SERVER_MSG_BYTES = 256 * 1024;
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

export const Teleport = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('booth'), slug: Slug }),
  z.object({ kind: z.literal('district'), slug: Slug }),
]);
export type Teleport = z.infer<typeof Teleport>;

export const PlayerSummary = z.object({
  id: NetId,
  name: PlayerName,
  isGuest: z.boolean(),
  /** Profile id for signed-in players (powers "Maker is here"); absent for guests. */
  uid: Uuid.optional(),
  avatar: AvatarStyle,
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
      avatar: AvatarStyle,
    })
    .refine((m) => m.token !== undefined || m.guestId !== undefined, {
      message: 'hello needs a token or a guestId',
    }),
  z.object({ type: z.literal('move'), p: NetPos, r: NetYaw, a: Uint8, t: TimeMs }),
  z.object({ type: z.literal('emote'), e: Uint8 }),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(CHAT_MAX_CHARS) }),
  z.object({ type: z.literal('teleport'), to: Teleport }),
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

// --- codec -----------------------------------------------------------------------------------

export interface DecodeError {
  readonly code: 'too_large' | 'malformed' | 'invalid';
  readonly message: string;
}

let packr: Packr | undefined;

// Plain msgpack maps and arrays: no record extension, so every frame decodes on its own.
// variableMapSize uses the 1-byte fixmap header for small maps instead of map16.
const getPackr = (): Packr => {
  packr ??= new Packr({
    useRecords: false,
    moreTypes: false,
    mapsAsObjects: true,
    variableMapSize: true,
  });
  return packr;
};

// msgpackr returns a view into its shared 8 KB pool, which the next pack() overwrites, and whose
// .buffer holds other recent messages. Copy, so the result owns exactly its own bytes.
const pack = (msg: ClientMessage | ServerMessage): Uint8Array =>
  new Uint8Array(getPackr().pack(msg));

// Messages are typed at compile time, so encoding skips validation. Receivers always validate.
export const encodeClient = (msg: ClientMessage): Uint8Array => pack(msg);
export const encodeServer = (msg: ServerMessage): Uint8Array => pack(msg);

export const decodeClient = (buf: Uint8Array | ArrayBuffer): Result<ClientMessage, DecodeError> =>
  decode(buf, ClientMessage, MAX_CLIENT_MSG_BYTES);

export const decodeServer = (buf: Uint8Array | ArrayBuffer): Result<ServerMessage, DecodeError> =>
  decode(buf, ServerMessage, MAX_SERVER_MSG_BYTES);

function decode<T>(
  buf: Uint8Array | ArrayBuffer,
  schema: z.ZodType<T>,
  maxBytes: number,
): Result<T, DecodeError> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength > maxBytes) {
    return err({ code: 'too_large', message: `${bytes.byteLength} bytes > ${maxBytes}` });
  }
  let raw: unknown;
  try {
    raw = getPackr().unpack(bytes);
  } catch (cause) {
    return err({
      code: 'malformed',
      message: cause instanceof Error ? cause.message : 'unpack failed',
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return err({ code: 'invalid', message: `${where}${issue?.message ?? 'invalid message'}` });
  }
  return ok(parsed.data);
}
