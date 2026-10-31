import {
  AvatarStyle,
  type ClientMessage,
  decodeServer,
  encodeClient,
  layoutCity,
  PROTOCOL_VERSION,
  toNetPos,
  toNetYaw,
} from '@shipfair/shared';
import { fakeWorld } from '@shipfair/shared/fake-world';
import { PartySocket } from 'partysocket';

// One bot: joins through the coordinator, walks random paths at 10 Hz with idle pauses (1 Hz
// heartbeat), emotes and chats now and then, and records what it sees.

const WORLD = fakeWorld(60, 7); // same as web-stub.ts
const BOUNDS = layoutCity(WORLD.districts, WORLD.booths).bounds;
const SEND_MS = 100;
const IDLE_SEND_MS = 1000;
const WALK_MPS = 4.5;
const PING_MS = 5000;

export interface BotStats {
  /** Local arrival time of each snap (ms). */
  snapTimes: number[];
  /** Server tick time (`snap.t`) of each snap, to tell missing ticks from late ones. */
  snapServerTimes: number[];
  snapBytes: number;
  snapEntries: number;
  framesIn: number;
  bytesIn: number;
  framesOut: number;
  corrections: number;
  shardFull: number;
  closes: Record<string, number>;
  joinErrors: number;
  chatsHeard: number;
}

export function emptyStats(): BotStats {
  return {
    snapTimes: [],
    snapServerTimes: [],
    snapBytes: 0,
    snapEntries: 0,
    framesIn: 0,
    bytesIn: 0,
    framesOut: 0,
    corrections: 0,
    shardFull: 0,
    closes: {},
    joinErrors: 0,
    chatsHeard: 0,
  };
}

export interface BotOptions {
  readonly host: string;
  readonly protocol: 'http' | 'https';
  readonly guestId: string;
  readonly token?: string;
  readonly random: () => number;
  readonly stats: BotStats;
}

const between = (random: () => number, min: number, max: number) => min + random() * (max - min);

export class Bot {
  readonly #o: BotOptions;
  #socket: PartySocket | null = null;
  #timers: ReturnType<typeof setTimeout>[] = [];
  #x = 0;
  #z = 0;
  #yaw = 0;
  #target: { x: number; z: number } | null = null;
  #idleUntil = 0;
  #lastSend = 0;
  #stopped = false;
  shard = '';

  constructor(options: BotOptions) {
    this.#o = options;
    const r = options.random;
    this.#x = between(r, -20, 20);
    this.#z = between(r, -20, 20);
  }

  async start(): Promise<void> {
    const { host, protocol, stats } = this.#o;
    let shard: string;
    try {
      const res = await fetch(`${protocol}://${host}/parties/coordinator/main/join`);
      shard = ((await res.json()) as { shard: string }).shard;
    } catch {
      stats.joinErrors++;
      return;
    }
    this.shard = shard;
    const socket = new PartySocket({
      host,
      protocol: protocol === 'https' ? 'wss' : 'ws',
      party: 'world-shard',
      room: shard,
      maxRetries: 0,
      // A socket that isn't open by then is closed by PartySocket with code 1000.
      connectionTimeout: 10_000,
    });
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;
    socket.addEventListener('open', () => this.#hello());
    socket.addEventListener('message', (event) => this.#onMessage(event.data as ArrayBuffer));
    socket.addEventListener('close', (event) => {
      if (this.#stopped) return;
      const key = String(event.code);
      stats.closes[key] = (stats.closes[key] ?? 0) + 1;
      this.#clearTimers();
    });
  }

  #send(msg: ClientMessage): void {
    const socket = this.#socket;
    if (socket?.readyState !== 1) return;
    // encodeClient returns a copy that owns its ArrayBuffer (protocol.ts), so the cast is safe.
    socket.send(encodeClient(msg) as Uint8Array<ArrayBuffer>);
    this.#o.stats.framesOut++;
  }

  #hello(): void {
    const { token, guestId } = this.#o;
    this.#send({
      type: 'hello',
      v: PROTOCOL_VERSION,
      avatar: AvatarStyle.parse({}),
      ...(token ? { token } : { guestId }),
    });
  }

  #onMessage(data: ArrayBuffer): void {
    const { stats } = this.#o;
    stats.framesIn++;
    stats.bytesIn += data.byteLength;
    const decoded = decodeServer(new Uint8Array(data));
    if (!decoded.ok) return;
    const msg = decoded.value;
    switch (msg.type) {
      case 'welcome':
        this.#begin();
        return;
      case 'snap':
        stats.snapTimes.push(performance.now());
        stats.snapServerTimes.push(msg.t);
        stats.snapBytes += data.byteLength;
        stats.snapEntries += msg.s.length;
        return;
      case 'chat':
        stats.chatsHeard++;
        return;
      case 'notice':
        if (msg.code === 'correct') {
          stats.corrections++;
          this.#x = msg.data.p[0] / 100;
          this.#z = msg.data.p[2] / 100;
        }
        if (msg.code === 'shard_full') stats.shardFull++;
        return;
      default:
        return;
    }
  }

  #every(ms: number, fn: () => void): void {
    const loop = () => {
      if (this.#stopped) return;
      fn();
      this.#timers.push(setTimeout(loop, ms));
    };
    this.#timers.push(setTimeout(loop, ms * this.#o.random()));
  }

  #begin(): void {
    const r = this.#o.random;
    this.#lastSend = performance.now();
    this.#move(); // first move places the bot
    this.#every(SEND_MS, () => this.#step());
    this.#every(PING_MS, () => this.#send({ type: 'ping', t: Math.floor(performance.now()) }));
    this.#every(between(r, 15_000, 30_000), () =>
      this.#send({ type: 'emote', e: Math.floor(r() * 8) }),
    );
    if (this.#o.token) {
      this.#every(between(r, 30_000, 60_000), () =>
        this.#send({ type: 'chat', text: `hello from ${this.shard}, nice booth!` }),
      );
    }
  }

  #move(): void {
    this.#send({
      type: 'move',
      p: [toNetPos(this.#x), 0, toNetPos(this.#z)],
      r: toNetYaw(this.#yaw),
      a: this.#target ? 2 : 0,
      t: Math.floor(performance.now()),
    });
    this.#lastSend = performance.now();
  }

  /** Walks toward a target at WALK_MPS, then idles 2–8 s (heartbeat only), then picks another. */
  #step(): void {
    const now = performance.now();
    const r = this.#o.random;
    if (!this.#target) {
      if (now < this.#idleUntil) {
        if (now - this.#lastSend >= IDLE_SEND_MS) this.#move();
        return;
      }
      this.#target = {
        x: between(r, BOUNDS.minX + 2, BOUNDS.maxX - 2),
        z: between(r, BOUNDS.minZ + 2, BOUNDS.maxZ - 2),
      };
    }
    const dx = this.#target.x - this.#x;
    const dz = this.#target.z - this.#z;
    const dist = Math.hypot(dx, dz);
    const step = (WALK_MPS * SEND_MS) / 1000;
    if (dist <= step) {
      this.#x = this.#target.x;
      this.#z = this.#target.z;
      this.#target = null;
      this.#idleUntil = now + between(r, 2000, 8000);
    } else {
      this.#x += (dx / dist) * step;
      this.#z += (dz / dist) * step;
      this.#yaw = Math.atan2(dx, dz);
    }
    this.#move();
  }

  #clearTimers(): void {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers = [];
  }

  stop(): void {
    this.#stopped = true;
    this.#clearTimers();
    this.#socket?.close(1000, 'load test over');
  }
}
