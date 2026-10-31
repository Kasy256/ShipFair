import {
  type ClientMessage,
  createBus,
  DEFAULT_AVATAR_STYLE,
  decodeClient,
  type EngineEvents,
  encodeServer,
  IDLE_HEARTBEAT_HZ,
  NET_ANIM,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@shipfair/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClockSync } from '../core/clock-sync.ts';
import {
  type LocalNetState,
  NetClient,
  type PlayerSummaryLike,
  type RemoteSink,
} from './client.ts';
import type { SocketLike } from './socket.ts';

const GUEST = '5f0c6c0e-3a8b-4c55-9a51-0b7e2f1e9d10';
const DT = 1 / 60;

class FakeSocket implements SocketLike {
  isOpen = false;
  retryCount = 0;
  room: string;
  readonly sent: ClientMessage[] = [];
  closedWith: number | null = null;
  onOpen = () => {};
  onMessage = (_data: ArrayBuffer) => {};
  onClose = (_code: number) => {};

  constructor(room: string) {
    this.room = room;
  }

  send(bytes: Uint8Array): void {
    const decoded = decodeClient(bytes);
    if (!decoded.ok) throw new Error(`client sent an invalid frame: ${decoded.error.message}`);
    this.sent.push(decoded.value);
  }

  moveTo(shard: string): void {
    this.room = shard;
  }

  close(code: number): void {
    this.closedWith = code;
    this.isOpen = false;
  }

  open(): void {
    this.isOpen = true;
    this.onOpen();
  }

  drop(code: number): void {
    this.isOpen = false;
    this.onClose(code);
  }

  receive(msg: ServerMessage): void {
    const bytes = encodeServer(msg);
    this.onMessage(bytes.buffer as ArrayBuffer);
  }

  of<T extends ClientMessage['type']>(type: T): Extract<ClientMessage, { type: T }>[] {
    return this.sent.filter((m): m is Extract<ClientMessage, { type: T }> => m.type === type);
  }
}

class FakeRemotes implements RemoteSink {
  readonly players = new Map<number, PlayerSummaryLike>();
  readonly snaps: [number, number, number][] = [];
  readonly emotes: [number, number][] = [];
  cleared = 0;
  get size() {
    return this.players.size;
  }
  welcome(players: readonly PlayerSummaryLike[]) {
    this.players.clear();
    for (const p of players) this.players.set(p.id, p);
  }
  join(p: PlayerSummaryLike) {
    this.players.set(p.id, p);
  }
  leave(id: number) {
    this.players.delete(id);
  }
  snap(id: number, t: number, x: number) {
    this.snaps.push([id, t, x]);
  }
  emote(id: number, e: number) {
    this.emotes.push([id, e]);
  }
  nameOf(id: number) {
    return this.players.get(id)?.name ?? null;
  }
  clear() {
    this.cleared++;
    this.players.clear();
  }
}

const summary = (id: number, name = `Guest-${id}`): PlayerSummaryLike => ({
  id,
  name,
  isGuest: true,
  avatar: DEFAULT_AVATAR_STYLE,
  p: [0, 0, 0],
  r: 0,
  a: 0,
});

function setup(opts: { token?: string | null; shard?: string | null } = {}) {
  const bus = createBus<EngineEvents>();
  const events: { type: string; payload: unknown }[] = [];
  for (const type of [
    'net:status',
    'net:population',
    'net:notice',
    'world:changed',
    'chat:incoming',
  ] as const) {
    bus.on(type, (payload) => events.push({ type, payload: structuredClone(payload) }));
  }
  const remotes = new FakeRemotes();
  const clock = new ClockSync();
  const local: LocalNetState = { x: 0, y: 0, z: 0, yaw: 0, anim: NET_ANIM.idle };
  const corrections: number[][] = [];
  const sockets: FakeSocket[] = [];
  const joins: (string | null)[] = [];
  let now = 1000;
  const client = new NetClient({
    bus,
    remotes,
    clock,
    local: () => local,
    avatar: () => DEFAULT_AVATAR_STYLE,
    correct: (x, y, z, yaw) => corrections.push([x, y, z, yaw]),
    now: () => now,
    join: async (_host, _isLocal, shard) => {
      joins.push(shard);
      return shard ?? 'w-1';
    },
    open: ({ shard }) => {
      const socket = new FakeSocket(shard);
      sockets.push(socket);
      return socket;
    },
  });
  client.connect({
    host: 'localhost:1999',
    shard: opts.shard ?? null,
    identity: {
      guestId: GUEST,
      getToken: async () => opts.token ?? null,
    },
  });
  const socket = async () => {
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    return sockets[sockets.length - 1] as FakeSocket;
  };
  const welcome = async (s: FakeSocket, players: PlayerSummaryLike[] = []) => {
    s.open();
    await vi.waitFor(() => expect(s.of('hello')).toHaveLength(s.of('hello').length || 1));
    s.receive({ type: 'welcome', you: 1, shard: s.room, players: [summary(1), ...players] });
  };
  const step = (seconds: number, frames = Math.round(seconds / DT)) => {
    for (let i = 0; i < frames; i++) {
      now += DT * 1000;
      client.update(DT);
    }
  };
  return {
    client,
    bus,
    events,
    remotes,
    clock,
    local,
    corrections,
    socket,
    welcome,
    step,
    joins,
    sockets,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('NetClient', () => {
  it('joins the coordinator shard and says hello with the guest id and the v2 look', async () => {
    const t = setup();
    const s = await t.socket();
    expect(t.joins).toEqual([null]);
    s.open();
    await vi.waitFor(() => expect(s.of('hello')).toHaveLength(1));
    expect(s.of('hello')[0]).toMatchObject({
      v: PROTOCOL_VERSION,
      guestId: GUEST,
      avatar: DEFAULT_AVATAR_STYLE,
    });
    expect(s.of('hello')[0]?.token).toBeUndefined();
  });

  it("sends the token when signed in, and asks for the friend's shard", async () => {
    const t = setup({ token: 'eyJ.token.sig', shard: 'w-2' });
    const s = await t.socket();
    expect(t.joins).toEqual(['w-2']);
    expect(s.room).toBe('w-2');
    s.open();
    await vi.waitFor(() => expect(s.of('hello')[0]?.token).toBe('eyJ.token.sig'));
  });

  it('goes online on welcome, ignores itself, and says hello again after a reconnect', async () => {
    const t = setup();
    const s = await t.socket();
    await t.welcome(s, [summary(2, 'Ada')]);
    expect(t.client.status).toBe('online');
    expect([...t.remotes.players.keys()]).toEqual([2]);
    const cleared = t.remotes.cleared;
    s.drop(1006);
    expect(t.client.status).toBe('reconnecting');
    expect(t.remotes.cleared).toBe(cleared + 1);
    s.open(); // partysocket reopened the same socket
    await vi.waitFor(() => expect(s.of('hello')).toHaveLength(2));
  });

  it('sends moves at 10 Hz while moving, a 1 Hz heartbeat when idle', async () => {
    const t = setup();
    const s = await t.socket();
    await t.welcome(s);
    t.step(DT, 1); // the first update announces the position
    expect(s.of('move')).toHaveLength(1);
    t.step(2); // idle for 2 s
    expect(s.of('move')).toHaveLength(1 + Math.floor(2 * IDLE_HEARTBEAT_HZ));
    const before = s.of('move').length;
    for (let i = 0; i < 60; i++) {
      t.local.x += 3 * DT; // walking at 3 m/s
      t.local.anim = NET_ANIM.walk;
      t.step(DT, 1);
    }
    const sent = s.of('move').length - before;
    expect(sent).toBe(10);
    expect(s.of('move').at(-1)).toMatchObject({
      a: NET_ANIM.walk,
      p: [Math.round(t.local.x * 100), 0, 0],
    });
  });

  it('sends a turn on the spot (over 1°), but not a 2 mm shuffle', async () => {
    const t = setup();
    const s = await t.socket();
    await t.welcome(s);
    t.step(DT, 1);
    const before = s.of('move').length;
    t.local.x += 0.002;
    t.step(0.3);
    expect(s.of('move').length).toBe(before);
    t.local.yaw += (2 * Math.PI) / 180;
    t.step(0.2);
    expect(s.of('move').length).toBe(before + 1);
  });

  it('pings every 5 s and measures the RTT from pong', async () => {
    const t = setup();
    const s = await t.socket();
    await t.welcome(s);
    t.step(DT, 1);
    const ping = s.of('ping')[0];
    expect(ping).toBeDefined();
    t.step(0.05);
    s.receive({ type: 'pong', t: ping?.t ?? 0 });
    expect(t.clock.rttMs).toBeGreaterThan(40);
    t.step(5);
    expect(s.of('ping')).toHaveLength(2);
  });

  it('feeds snapshots through the codec into the remote view and the clock', async () => {
    const t = setup();
    const s = await t.socket();
    await t.welcome(s, [summary(2)]);
    s.receive({
      type: 'snap',
      t: 50_000,
      s: [
        [2, 150, 0, -20, 0, 1],
        [1, 999, 0, 0, 0, 0],
      ],
    });
    expect(t.remotes.snaps).toEqual([[2, 50_000, 1.5]]); // its own entry is skipped
    expect(t.clock.isReady).toBe(true);
  });

  it('counts visitors nearby from welcome, joins and leaves, and the total from population', async () => {
    const t = setup();
    const s = await t.socket();
    await t.welcome(s, [summary(2), summary(3)]);
    s.receive({ type: 'join', player: summary(4) });
    s.receive({ type: 'leave', id: 2 });
    s.receive({ type: 'notice', code: 'population', message: '', data: { shard: 9, total: 120 } });
    const population = t.events.filter((e) => e.type === 'net:population').map((e) => e.payload);
    expect(population.at(-1)).toEqual({ nearby: 3, total: 120 });
  });

  it('blends to the server position on correct', async () => {
    const t = setup();
    const s = await t.socket();
    await t.welcome(s);
    s.receive({ type: 'notice', code: 'correct', message: '', data: { p: [100, 0, -250], r: 0 } });
    expect(t.corrections).toEqual([[1, 0, -2.5, 0]]);
  });

  it('follows a shard_full suggestion', async () => {
    const t = setup();
    const s = await t.socket();
    s.open();
    s.receive({ type: 'notice', code: 'shard_full', message: 'Full', data: { shard: 'w-3' } });
    s.drop(4001);
    expect(s.room).toBe('w-3');
    expect(t.client.status).toBe('reconnecting');
  });

  it('passes update_required, bans, kicks, mutes and world updates to the bus', async () => {
    const t = setup();
    const s = await t.socket();
    await t.welcome(s);
    s.receive({ type: 'notice', code: 'muted', message: 'Muted', data: { until: 99 } });
    s.receive({ type: 'notice', code: 'world_update', message: '', data: { boothIds: [GUEST] } });
    s.receive({ type: 'notice', code: 'update_required', message: 'Refresh' });
    s.drop(4000);
    expect(t.events.filter((e) => e.type !== 'net:population' && e.type !== 'net:status')).toEqual([
      { type: 'net:notice', payload: { code: 'muted', message: 'Muted', until: 99 } },
      { type: 'world:changed', payload: { boothIds: [GUEST] } },
      { type: 'net:notice', payload: { code: 'update_required', message: 'Refresh', until: null } },
    ]);
    expect(t.client.status).toBe('offline'); // terminal: no reconnect
  });

  it('names chat senders from the remote list', async () => {
    const t = setup();
    const s = await t.socket();
    await t.welcome(s, [summary(2, 'Ada')]);
    s.receive({ type: 'chat', id: 2, text: 'hi', ts: 5 });
    expect(t.events.find((e) => e.type === 'chat:incoming')?.payload).toEqual({
      id: 2,
      name: 'Ada',
      text: 'hi',
      ts: 5,
    });
  });

  it('drops invalid frames without throwing', async () => {
    const t = setup();
    const s = await t.socket();
    s.open();
    s.onMessage(new Uint8Array([0xc1]).buffer);
    expect(t.client.stats.invalid).toBe(1);
  });

  it('stays offline and retries when the coordinator is down, never throwing', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bus = createBus<EngineEvents>();
    let calls = 0;
    const client = new NetClient({
      bus,
      remotes: new FakeRemotes(),
      clock: new ClockSync(),
      local: () => ({ x: 0, y: 0, z: 0, yaw: 0, anim: 0 }),
      avatar: () => DEFAULT_AVATAR_STYLE,
      correct: () => {},
      join: async () => {
        calls++;
        throw new Error('ECONNREFUSED');
      },
    });
    client.connect({ host: 'localhost:1999', identity: { guestId: GUEST } });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status).toBe('offline');
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(2);
    client.disconnect();
    vi.useRealTimers();
    expect(warn).toHaveBeenCalled();
  });
});
