// The msgpack codec for the protocol in protocol.ts. A separate entry point
// (`@shipfair/shared/codec`), not re-exported from the package index: msgpackr is ~10 kB gzipped,
// and the browser only needs it once it connects to a shard, so the engine imports it then
// (prompt 14). The realtime server, load test and tests import it directly.
import { Packr } from 'msgpackr';
import type * as z from 'zod';
import { MAX_CLIENT_MSG_BYTES } from './constants.ts';
import { ClientMessage, ServerMessage, type SnapEntry } from './protocol.ts';
import { err, ok, type Result } from './result.ts';

const MAX_SERVER_MSG_BYTES = 256 * 1024;

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

// --- snap fast path (realtime server) --------------------------------------------------------

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));
// fixmap(3), "type": "snap", "t" (then t's own encoding), and later "s" (then the array).
const SNAP_HEAD = Uint8Array.from([
  0x83,
  0xa4,
  ...ascii('type'),
  0xa4,
  ...ascii('snap'),
  0xa1,
  0x74,
]);
const SNAP_S = Uint8Array.from([0xa1, 0x73]);
const FIXARRAY_MAX = 15;
const ARRAY16_MAX = 0xffff;

/** One `snap` entry, packed once per tick and shared by every recipient's frame (`encodeSnap`). */
export const encodeSnapEntry = (entry: SnapEntry): Uint8Array =>
  new Uint8Array(getPackr().pack(entry));

/**
 * `encodeServer({ type: 'snap', t, s })` from pre-packed entries: the header and array length are
 * written here and the entry bytes copied in. A shard packs each player's entry once per tick
 * instead of once per recipient. Byte-identical to `encodeServer` (protocol.test.ts).
 */
export function encodeSnap(t: number, entries: readonly Uint8Array[]): Uint8Array {
  const n = entries.length;
  const arrayHead = n <= FIXARRAY_MAX ? 1 : n <= ARRAY16_MAX ? 3 : 5;
  let size = SNAP_HEAD.length + SNAP_S.length + arrayHead;
  for (const entry of entries) size += entry.byteLength;
  const packedT = getPackr().pack(t); // a view into msgpackr's pool: copy it before packing again
  const out = new Uint8Array(size + packedT.byteLength);
  let at = 0;
  out.set(SNAP_HEAD, at);
  at += SNAP_HEAD.length;
  out.set(packedT, at);
  at += packedT.byteLength;
  out.set(SNAP_S, at);
  at += SNAP_S.length;
  if (n <= FIXARRAY_MAX) {
    out[at++] = 0x90 | n;
  } else if (n <= ARRAY16_MAX) {
    out[at++] = 0xdc;
    out[at++] = n >>> 8;
    out[at++] = n & 0xff;
  } else {
    out[at++] = 0xdd;
    out[at++] = n >>> 24;
    out[at++] = (n >>> 16) & 0xff;
    out[at++] = (n >>> 8) & 0xff;
    out[at++] = n & 0xff;
  }
  for (const entry of entries) {
    out.set(entry, at);
    at += entry.byteLength;
  }
  return out;
}

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
