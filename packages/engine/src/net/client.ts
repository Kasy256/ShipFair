import {
  type AvatarStyleV2,
  CLIENT_SEND_HZ,
  type ClientMessage,
  decodeServer,
  type EventBus,
  encodeClient,
  fromNetPos,
  fromNetYaw,
  IDLE_HEARTBEAT_HZ,
  type NetStatus,
  PING_HZ,
  PROTOCOL_VERSION,
  type ServerMessage,
  ShardId,
  toNetPos,
  toNetYaw,
} from '@shipfair/shared';
import {
  NET_OFFLINE_AFTER_RETRIES,
  NET_RETRY_MAX_S,
  NET_RETRY_MIN_S,
  NET_SEND_MIN_MOVE_M,
  NET_SEND_MIN_TURN_RAD,
} from '../config.ts';
import type { ClockSync } from '../core/clock-sync.ts';
import type { System } from '../core/loop.ts';
import { shortestArc } from '../core/snapshot-buffer.ts';
import { joinShard, openSocket, type SocketLike, TERMINAL_CLOSES } from './socket.ts';

// The realtime client (ARCHITECTURE.md §7). Asks the coordinator for a shard, connects with
// partysocket (which reconnects with backoff), says hello on every (re)connect, sends `move` at
// CLIENT_SEND_HZ while moving and a heartbeat when idle, pings every 5 s, and hands everything it
// receives to the remote-player view, the local player and the bus. It never blocks the world:
// every failure only changes the status pill, and exploring solo keeps working.

/** Where remote players go. Implemented by `RemotePlayers`. */
export interface RemoteSink {
  welcome(players: readonly PlayerSummaryLike[]): void;
  join(player: PlayerSummaryLike): void;
  leave(id: number): void;
  snap(id: number, t: number, x: number, y: number, z: number, yaw: number, anim: number): void;
  emote(id: number, e: number): void;
  nameOf(id: number): string | null;
  /** Players currently shown (for the visitor count). */
  readonly size: number;
  /** Fade everyone out (the connection dropped). */
  clear(): void;
}

export type PlayerSummaryLike = Extract<ServerMessage, { type: 'join' }>['player'];

/** The local player as the client sends it; read once per frame from one reused object. */
export interface LocalNetState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
}

export interface NetIdentity {
  /** The stable local guest id (sent even when signed in; the token wins on the server). */
  guestId: string;
  /** A fresh Supabase access token for each hello, or null for a guest. */
  getToken?: () => Promise<string | null>;
}

export interface NetConnectOptions {
  /** `VITE_REALTIME_HOST`, e.g. `rt.shipfair.xyz` or `localhost:1999`. */
  host: string;
  /** A shard to join (the "join friend" `?with=w-2` link); otherwise the coordinator picks. */
  shard?: string | null;
  identity: NetIdentity;
}

export interface NetClientDeps {
  bus: EventBus;
  remotes: RemoteSink;
  clock: ClockSync;
  local: () => Readonly<LocalNetState>;
  avatar: () => AvatarStyleV2;
  /** Server `correct`: blend the local player to this position. */
  correct: (x: number, y: number, z: number, yaw: number) => void;
  now?: () => number;
  /** For tests: replace the socket and the coordinator call. */
  open?: typeof openSocket;
  join?: typeof joinShard;
}

/** Float slack, so that six 1/60 s frames always add up to one 1/10 s send interval. */
const EPSILON_S = 1e-6;

const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

export class NetClient implements System {
  readonly #deps: NetClientDeps;
  readonly #now: () => number;
  readonly #open: typeof openSocket;
  readonly #join: typeof joinShard;
  #options: NetConnectOptions | null = null;
  #socket: SocketLike | null = null;
  #status: NetStatus = 'offline';
  #shard: string | null = null;
  #you = -1;
  #isWelcomed = false;
  #total: number | null = null;
  #sinceSend = 0;
  #sincePing = 0;
  #retryS = NET_RETRY_MIN_S;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #session = 0;
  readonly #sent = { x: Number.NaN, y: 0, z: 0, yaw: 0, anim: -1 };
  readonly #move = {
    type: 'move' as const,
    p: [0, 0, 0] as [number, number, number],
    r: 0,
    a: 0,
    t: 0,
  };
  /** Messages sent and received (test API). */
  readonly stats = { sent: 0, received: 0, hellos: 0, invalid: 0 };

  constructor(deps: NetClientDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => performance.now());
    this.#open = deps.open ?? openSocket;
    this.#join = deps.join ?? joinShard;
  }

  get status(): NetStatus {
    return this.#status;
  }

  get shard(): string | null {
    return this.#shard;
  }

  /** This player's shard-local id (−1 before welcome). */
  get you(): number {
    return this.#you;
  }

  /** Connects (or reconnects with a new identity). Never throws; failures retry with backoff. */
  connect(options: NetConnectOptions): void {
    this.disconnect();
    this.#options = options;
    this.#retryS = NET_RETRY_MIN_S;
    this.#setStatus('connecting');
    void this.#start(++this.#session);
  }

  disconnect(): void {
    this.#session++;
    clearTimeout(this.#retryTimer);
    const socket = this.#socket;
    this.#socket = null;
    socket?.close(1000, 'Leaving');
    this.#lost();
    this.#options = null;
    this.#setStatus('offline');
  }

  sendEmote(e: number): void {
    if (this.#isWelcomed) this.#send({ type: 'emote', e });
  }

  update(dt: number): void {
    if (!this.#isWelcomed) return;
    this.#sinceSend += dt;
    this.#sincePing += dt;
    if (this.#sincePing >= 1 / PING_HZ - EPSILON_S) {
      this.#sincePing = 0;
      this.#send({ type: 'ping', t: Math.max(0, Math.floor(this.#now())) });
    }
    const local = this.#deps.local();
    const sent = this.#sent;
    const dx = local.x - sent.x;
    const dy = local.y - sent.y;
    const dz = local.z - sent.z;
    const hasMoved =
      Number.isNaN(sent.x) ||
      dx * dx + dy * dy + dz * dz > NET_SEND_MIN_MOVE_M * NET_SEND_MIN_MOVE_M ||
      Math.abs(shortestArc(sent.yaw, local.yaw)) > NET_SEND_MIN_TURN_RAD ||
      local.anim !== sent.anim;
    const interval = hasMoved ? 1 / CLIENT_SEND_HZ : 1 / IDLE_HEARTBEAT_HZ;
    const isDue = this.#sinceSend >= interval - EPSILON_S;
    if (!isDue) return;
    this.#sinceSend = 0;
    sent.x = local.x;
    sent.y = local.y;
    sent.z = local.z;
    sent.yaw = local.yaw;
    sent.anim = local.anim;
    const move = this.#move;
    move.p[0] = toNetPos(local.x);
    move.p[1] = toNetPos(local.y);
    move.p[2] = toNetPos(local.z);
    move.r = toNetYaw(local.yaw);
    move.a = local.anim;
    move.t = Math.max(0, Math.floor(this.#now()));
    this.#send(move);
  }

  dispose(): void {
    this.disconnect();
  }

  async #start(session: number): Promise<void> {
    const options = this.#options;
    if (!options) return;
    let shard: string;
    try {
      shard = await this.#join(options.host, isLocalHost(options.host), options.shard ?? null);
    } catch (error) {
      if (session !== this.#session) return;
      console.warn(`Realtime join failed; exploring solo, retrying in ${this.#retryS} s`, error);
      this.#setStatus('offline');
      this.#retryTimer = setTimeout(() => void this.#start(session), this.#retryS * 1000);
      this.#retryS = Math.min(this.#retryS * 2, NET_RETRY_MAX_S);
      return;
    }
    if (session !== this.#session) return;
    this.#shard = shard;
    const socket = this.#open({ host: options.host, isSecure: !isLocalHost(options.host), shard });
    this.#socket = socket;
    socket.onOpen = () => void this.#hello(socket, session);
    socket.onMessage = (data) => this.#receive(data);
    socket.onClose = (code) => this.#closed(socket, code);
  }

  async #hello(socket: SocketLike, session: number): Promise<void> {
    const options = this.#options;
    if (!options) return;
    let token: string | null = null;
    try {
      token = (await options.identity.getToken?.()) ?? null;
    } catch (error) {
      console.warn('No access token for realtime; joining as the guest', error);
    }
    if (session !== this.#session || socket !== this.#socket || !socket.isOpen) return;
    this.stats.hellos++;
    this.#send({
      type: 'hello',
      v: PROTOCOL_VERSION,
      guestId: options.identity.guestId,
      avatar: this.#deps.avatar(),
      ...(token ? { token } : {}),
    });
  }

  #closed(socket: SocketLike, code: number): void {
    if (socket !== this.#socket) return;
    this.#lost();
    if (TERMINAL_CLOSES.has(code)) {
      this.#socket = null;
      this.#setStatus('offline');
      return;
    }
    this.#setStatus(socket.retryCount >= NET_OFFLINE_AFTER_RETRIES ? 'offline' : 'reconnecting');
  }

  /** The connection is gone (or replaced): remote players fade out, sends stop. */
  #lost(): void {
    this.#isWelcomed = false;
    this.#you = -1;
    this.#sent.x = Number.NaN;
    this.#deps.clock.reset();
    this.#deps.remotes.clear();
    this.#population();
  }

  #receive(data: ArrayBuffer): void {
    const decoded = decodeServer(data);
    if (!decoded.ok) {
      this.stats.invalid++;
      console.warn('Realtime: dropped a server frame', decoded.error);
      return;
    }
    this.stats.received++;
    this.#handle(decoded.value);
  }

  #handle(msg: ServerMessage): void {
    const { remotes, clock, bus } = this.#deps;
    switch (msg.type) {
      case 'welcome':
        this.#you = msg.you;
        this.#shard = msg.shard;
        this.#isWelcomed = true;
        this.#sinceSend = Number.POSITIVE_INFINITY; // announce the real position at once
        this.#sincePing = Number.POSITIVE_INFINITY;
        this.#retryS = NET_RETRY_MIN_S;
        remotes.welcome(msg.players.filter((p) => p.id !== msg.you));
        this.#setStatus('online');
        this.#population();
        return;
      case 'snap':
        clock.onServerTime(msg.t, this.#now());
        for (const [id, x, y, z, r, a] of msg.s) {
          if (id === this.#you) continue;
          remotes.snap(id, msg.t, fromNetPos(x), fromNetPos(y), fromNetPos(z), fromNetYaw(r), a);
        }
        return;
      case 'join':
        if (msg.player.id === this.#you) return;
        remotes.join(msg.player);
        this.#population();
        return;
      case 'leave':
        remotes.leave(msg.id);
        this.#population();
        return;
      case 'emote':
        remotes.emote(msg.id, msg.e);
        return;
      case 'chat':
        bus.emit('chat:incoming', {
          id: msg.id,
          name: msg.id === this.#you ? 'You' : (remotes.nameOf(msg.id) ?? 'Someone'),
          text: msg.text,
          ts: msg.ts,
        });
        return;
      case 'pong':
        clock.onPong(msg.t, this.#now());
        return;
      case 'notice':
        this.#notice(msg);
    }
  }

  #notice(msg: Extract<ServerMessage, { type: 'notice' }>): void {
    const { bus } = this.#deps;
    switch (msg.code) {
      case 'correct':
        this.#deps.correct(
          fromNetPos(msg.data.p[0]),
          fromNetPos(msg.data.p[1]),
          fromNetPos(msg.data.p[2]),
          fromNetYaw(msg.data.r),
        );
        // What the server holds is what was last sent, or the next move would be refused too.
        this.#sent.x = Number.NaN;
        return;
      case 'shard_full': {
        // The server closes with 4001 next; partysocket then reconnects to the suggested room.
        const shard = ShardId.safeParse(msg.data.shard);
        if (shard.success) {
          this.#shard = shard.data;
          this.#socket?.moveTo(shard.data);
        }
        return;
      }
      case 'world_update':
        bus.emit('world:changed', { boothIds: msg.data.boothIds });
        return;
      case 'population':
        this.#total = msg.data.total;
        this.#population();
        return;
      case 'muted':
        bus.emit('net:notice', { code: 'muted', message: msg.message, until: msg.data.until });
        return;
      default:
        bus.emit('net:notice', { code: msg.code, message: msg.message, until: null });
    }
  }

  #population(): void {
    const nearby = this.#isWelcomed ? this.#deps.remotes.size + 1 : 1;
    this.#deps.bus.emit('net:population', {
      nearby,
      total: this.#isWelcomed ? this.#total : null,
    });
  }

  #send(msg: ClientMessage): void {
    const socket = this.#socket;
    if (!socket?.isOpen) return;
    socket.send(encodeClient(msg));
    this.stats.sent++;
  }

  #setStatus(status: NetStatus): void {
    if (status === this.#status) return;
    this.#status = status;
    this.#deps.bus.emit('net:status', { status, shard: this.#shard });
  }
}
