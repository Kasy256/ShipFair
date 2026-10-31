import { pack } from 'msgpackr';
import { describe, expect, it } from 'vitest';
import { MAX_CLIENT_MSG_BYTES, MAX_PLAYERS_PER_SHARD, PROTOCOL_VERSION } from './constants.ts';
import {
  type ClientMessage,
  decodeClient,
  decodeServer,
  encodeClient,
  encodeServer,
  encodeSnap,
  encodeSnapEntry,
  fromNetPos,
  fromNetYaw,
  isProtocolSupported,
  type PlayerSummary,
  type ServerMessage,
  type SnapEntry,
  toNetPos,
  toNetYaw,
} from './protocol.ts';
import { rangeInt, rng } from './rng.ts';
import { AvatarStyle } from './schemas/avatar.ts';

const avatar = AvatarStyle.parse({});
const uuid = '5f0c6c0e-3a8b-4c55-9a51-0b7e2f1e9d10';
const player: PlayerSummary = {
  id: 7,
  name: 'Guest-4821',
  isGuest: true,
  avatar,
  p: [120, 0, -340],
  r: 1024,
  a: 2,
};

const clientMessages: ClientMessage[] = [
  { type: 'hello', v: PROTOCOL_VERSION, token: 'eyJhbGciOi.test.sig', avatar },
  { type: 'hello', v: PROTOCOL_VERSION, guestId: uuid, avatar },
  { type: 'move', p: [-12_345, 80, 67_890], r: 65_535, a: 3, t: 1_793_000_000_123 },
  { type: 'emote', e: 4 },
  { type: 'chat', text: 'hello from the plaza 👋' },
  { type: 'teleport', to: { kind: 'booth', slug: 'my-cool-app' } },
  { type: 'teleport', to: { kind: 'district', slug: 'dev-tools' } },
  { type: 'ping', t: 123 },
];

const serverMessages: ServerMessage[] = [
  { type: 'welcome', you: 7, shard: 'w-1', players: [player] },
  { type: 'snap', t: 1_793_000_000_000, s: [[7, 120, 0, -340, 1024, 2]] },
  { type: 'join', player: { ...player, isGuest: false, uid: uuid, name: 'Ada' } },
  { type: 'leave', id: 7 },
  { type: 'emote', id: 7, e: 1 },
  { type: 'chat', id: 7, text: 'hi', ts: 99 },
  { type: 'pong', t: 123 },
  { type: 'notice', code: 'correct', message: '', data: { p: [0, 0, 0], r: 0 } },
  { type: 'notice', code: 'shard_full', message: 'Full', data: { shard: 'w-2' } },
  { type: 'notice', code: 'update_required', message: 'Reload to update' },
  { type: 'notice', code: 'banned', message: 'Banned' },
  { type: 'notice', code: 'kicked', message: 'Kicked' },
  { type: 'notice', code: 'muted', message: 'Muted', data: { until: 1_793_000_600_000 } },
  { type: 'notice', code: 'world_update', message: '', data: { boothIds: [uuid] } },
  { type: 'notice', code: 'population', message: '', data: { shard: 41, total: 230 } },
];

describe('protocol round trips', () => {
  it.each(clientMessages.map((m) => [m.type, m] as const))('client %s', (_, msg) => {
    expect(decodeClient(encodeClient(msg))).toEqual({ ok: true, value: msg });
  });

  it.each(
    serverMessages.map((m) => [m.type === 'notice' ? `notice:${m.code}` : m.type, m] as const),
  )('server %s', (_, msg) => {
    expect(decodeServer(encodeServer(msg))).toEqual({ ok: true, value: msg });
  });

  it('returns bytes that own their buffer and survive later encodes', () => {
    const first = encodeClient({ type: 'chat', text: 'secret one' });
    const copy = Uint8Array.from(first);
    const second = encodeClient({ type: 'chat', text: 'another message' });
    expect(first.buffer).not.toBe(second.buffer);
    expect(first.byteOffset).toBe(0);
    expect(first.buffer.byteLength).toBe(first.byteLength);
    expect(first).toEqual(copy);
  });

  it('accepts an ArrayBuffer', () => {
    const bytes = encodeClient({ type: 'ping', t: 1 });
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(decodeClient(copy as ArrayBuffer).ok).toBe(true);
  });
});

describe('invalid input returns an error, never throws', () => {
  const cases: [string, Uint8Array, string][] = [
    ['empty buffer', new Uint8Array(), 'malformed'],
    [
      'truncated msgpack',
      encodeClient({ type: 'chat', text: 'truncate me' }).slice(0, 5),
      'malformed',
    ],
    ['not an object', pack(42), 'invalid'],
    ['unknown type', pack({ type: 'fly', speed: 99 }), 'invalid'],
    ['float position', pack({ type: 'move', p: [1.5, 0, 0], r: 0, a: 0, t: 0 }), 'invalid'],
    ['yaw out of range', pack({ type: 'move', p: [0, 0, 0], r: 70_000, a: 0, t: 0 }), 'invalid'],
    ['short position', pack({ type: 'move', p: [0, 0], r: 0, a: 0, t: 0 }), 'invalid'],
    ['chat too long', pack({ type: 'chat', text: 'x'.repeat(161) }), 'invalid'],
    ['empty chat', pack({ type: 'chat', text: '' }), 'invalid'],
    ['hello without identity', pack({ type: 'hello', v: 1, avatar: {} }), 'invalid'],
    ['bad teleport', pack({ type: 'teleport', to: 'dev-tools' }), 'invalid'],
    ['too large', new Uint8Array(MAX_CLIENT_MSG_BYTES + 1), 'too_large'],
  ];

  it.each(cases)('%s', (_, bytes, code) => {
    const result = decodeClient(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  it('rejects a server message that is invalid', () => {
    const result = decodeServer(pack({ type: 'notice', code: 'muted', message: 'x' }));
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });

  it('survives 2,000 random byte strings', () => {
    const random = rng(1);
    for (let i = 0; i < 2000; i++) {
      const bytes = Uint8Array.from({ length: rangeInt(random, 1, 64) }, () =>
        rangeInt(random, 0, 255),
      );
      expect(() => decodeClient(bytes)).not.toThrow();
      expect(() => decodeServer(bytes)).not.toThrow();
    }
  });

  it('strips unknown fields', () => {
    const result = decodeClient(pack({ type: 'ping', t: 1, __proto__evil: true }));
    expect(result).toEqual({ ok: true, value: { type: 'ping', t: 1 } });
  });
});

describe('net unit helpers', () => {
  it('converts metres to whole centimetres and back', () => {
    expect(toNetPos(1.234)).toBe(123);
    expect(Object.is(toNetPos(-0.004), 0)).toBe(true); // never −0
    expect(toNetPos(-12.3456)).toBe(-1235);
    expect(fromNetPos(toNetPos(42.42))).toBe(42.42);
  });

  it('wraps yaw into uint16 with sub-0.006° error', () => {
    const step = (2 * Math.PI) / 65_536;
    for (const rad of [
      0,
      0.1,
      Math.PI / 2,
      Math.PI,
      3,
      -0.1,
      -Math.PI,
      7 * Math.PI,
      2 * Math.PI - step / 4,
    ]) {
      const net = toNetYaw(rad);
      expect(Number.isInteger(net) && net >= 0 && net < 65_536).toBe(true);
      const back = fromNetYaw(net);
      const diff = Math.abs(Math.atan2(Math.sin(back - rad), Math.cos(back - rad)));
      expect(diff).toBeLessThanOrEqual(step / 2 + 1e-12);
    }
    expect(toNetYaw(2 * Math.PI)).toBe(0);
    expect(toNetYaw(Math.PI / 2)).toBe(16_384);
  });

  it('accepts versions between MIN_CLIENT_PROTOCOL and PROTOCOL_VERSION', () => {
    expect(isProtocolSupported(PROTOCOL_VERSION)).toBe(true);
    expect(isProtocolSupported(0)).toBe(false);
    expect(isProtocolSupported(PROTOCOL_VERSION + 1)).toBe(false);
  });
});

describe('encodeSnap', () => {
  const entry = (i: number): SnapEntry => [
    i,
    i * 37 - 500,
    i % 3,
    -i * 91,
    (i * 977) % 65536,
    i % 8,
  ];

  it('is byte-identical to encodeServer for 0, 1, 15, 16, 60 and 70,000 entries', () => {
    for (const n of [0, 1, 15, 16, 60, 70_000]) {
      for (const t of [0, 1234, 1_793_000_000_000]) {
        const s = Array.from({ length: n }, (_, i) => entry(i % 65536));
        const fast = encodeSnap(t, s.map(encodeSnapEntry));
        expect(Buffer.from(fast).equals(Buffer.from(encodeServer({ type: 'snap', t, s })))).toBe(
          true,
        );
      }
    }
  });

  it('decodes back to the same snap', () => {
    const s = [entry(1), entry(2)];
    const decoded = decodeServer(encodeSnap(1_793_000_000_000, s.map(encodeSnapEntry)));
    expect(decoded).toEqual({ ok: true, value: { type: 'snap', t: 1_793_000_000_000, s } });
  });
});

describe('snap size', () => {
  it(`encodes ${MAX_PLAYERS_PER_SHARD} players compactly`, () => {
    const random = rng(60);
    // Players spread over a ±250 m city, standing on the ground or mid-jump.
    const s: SnapEntry[] = Array.from({ length: MAX_PLAYERS_PER_SHARD }, (_, id) => [
      id,
      rangeInt(random, -25_000, 25_000),
      rangeInt(random, 0, 150),
      rangeInt(random, -25_000, 25_000),
      rangeInt(random, 0, 65_535),
      rangeInt(random, 0, 7),
    ]);
    const bytes = encodeServer({ type: 'snap', t: 1_793_000_000_000, s });
    console.info(`snap for ${MAX_PLAYERS_PER_SHARD} players: ${bytes.byteLength} bytes`);
    expect(bytes.byteLength).toBeLessThan(1200);
    expect(decodeServer(bytes).ok).toBe(true);
  });
});
