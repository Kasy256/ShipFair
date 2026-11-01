import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import {
  type ClientMessage,
  DEFAULT_AVATAR_STYLE,
  decodeServer,
  encodeClient,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@shipfair/shared';
import { importJWK, SignJWT } from 'jose';
import type { Env } from '../env.ts';
import type { WorldShard } from '../world-shard.ts';
import { AUTH_URL, TEST_JWK } from './fixtures.ts';

// Helpers for the Worker tests: a WebSocket client that decodes server frames, deterministic
// control of a shard's clock and loop, and tokens signed with the auth stub's key.

export const testEnv = env as unknown as Env;

export const AVATAR = DEFAULT_AVATAR_STYLE;
const WAIT_MS = 3000;

export function hello(extra: Partial<Extract<ClientMessage, { type: 'hello' }>>): ClientMessage {
  return { type: 'hello', v: PROTOCOL_VERSION, avatar: AVATAR, ...extra } as ClientMessage;
}

let guestCounter = 0;
/** A fresh guest id per call, so guests never collide across tests. */
export const guestId = (): string =>
  `00000000-0000-4000-9000-${String(++guestCounter).padStart(12, '0')}`;

export interface Closed {
  readonly code: number;
  readonly reason: string;
}

export class TestClient {
  readonly ws: WebSocket;
  /** Frames received and not yet consumed by `next`. */
  readonly inbox: ServerMessage[] = [];
  closed: Closed | null = null;
  #waiters: (() => void)[] = [];
  #pingT = 0;
  /** Test-side sockets get binary frames as Blobs; reading them is async, so keep them in order. */
  #reading: Promise<void> = Promise.resolve();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const data: unknown = event.data;
      if (typeof data === 'string') return;
      this.#reading = this.#reading.then(async () => {
        const bytes = data instanceof Blob ? await data.arrayBuffer() : (data as ArrayBuffer);
        const decoded = decodeServer(new Uint8Array(bytes));
        if (decoded.ok) this.inbox.push(decoded.value);
        this.#wake();
      });
    });
    ws.addEventListener('close', (event) => {
      this.#reading = this.#reading.then(() => {
        this.closed = { code: event.code, reason: event.reason };
        this.#wake();
      });
    });
  }

  static async connect(shard: string): Promise<TestClient> {
    const res = await exports.default.fetch(`https://rt.test/parties/world-shard/${shard}`, {
      headers: { Upgrade: 'websocket' },
    });
    const ws = res.webSocket;
    if (!ws) throw new Error(`no WebSocket (status ${res.status})`);
    ws.accept();
    return new TestClient(ws);
  }

  /** Connects and completes a hello; resolves with the welcome. */
  static async join(
    shard: string,
    extra: Partial<Extract<ClientMessage, { type: 'hello' }>> = { guestId: guestId() },
  ): Promise<{ client: TestClient; welcome: Extract<ServerMessage, { type: 'welcome' }> }> {
    const client = await TestClient.connect(shard);
    client.send(hello(extra));
    const welcome = await client.next('welcome');
    return { client, welcome };
  }

  #wake(): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const wake of waiters) wake();
  }

  #changed(): Promise<void> {
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  send(msg: ClientMessage): void {
    this.ws.send(encodeClient(msg));
  }

  sendRaw(data: Uint8Array | string): void {
    this.ws.send(data);
  }

  /** The first unconsumed frame of `type` (and matching `where`), waiting up to 3 s for it. */
  async next<T extends ServerMessage['type']>(
    type: T,
    where: (msg: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const i = this.inbox.findIndex(
        (m) => m.type === type && where(m as Extract<ServerMessage, { type: T }>),
      );
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
      if (this.closed) throw new Error(`closed (${this.closed.code}) while waiting for ${type}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for ${type}`);
      await Promise.race([this.#changed(), new Promise((r) => setTimeout(r, left))]);
    }
  }

  async notice<C extends Extract<ServerMessage, { type: 'notice' }>['code']>(
    code: C,
  ): Promise<Extract<ServerMessage, { type: 'notice'; code: C }>> {
    return (await this.next('notice', (n) => n.code === code)) as Extract<
      ServerMessage,
      { type: 'notice'; code: C }
    >;
  }

  /**
   * A ping/pong round trip: the server handles a socket's frames in order, so once the pong is
   * back, everything sent before it has been processed.
   */
  async barrier(): Promise<void> {
    const t = ++this.#pingT;
    this.send({ type: 'ping', t });
    await this.next('pong', (m) => m.t === t);
  }

  async waitClosed(): Promise<Closed> {
    const deadline = Date.now() + WAIT_MS;
    while (!this.closed) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('timed out waiting for close');
      await Promise.race([this.#changed(), new Promise((r) => setTimeout(r, left))]);
    }
    return this.closed;
  }

  /** Unconsumed frames of a type, removed from the inbox. */
  take<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    const out: Extract<ServerMessage, { type: T }>[] = [];
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      if (this.inbox[i]?.type === type) {
        out.unshift(this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>);
      }
    }
    return out;
  }

  close(): void {
    this.ws.close(1000, 'bye');
  }
}

export const shardStub = (name: string): DurableObjectStub<WorldShard> =>
  testEnv.WorldShard.get(testEnv.WorldShard.idFromName(name));

/** A clock the test moves by hand; shards read it through `setClock`. */
export class TestClock {
  now: number;
  constructor(start = Date.UTC(2026, 9, 31, 12, 0, 0)) {
    this.now = start;
  }
  advance(ms: number): number {
    this.now += ms;
    return this.now;
  }
}

/** Points the shard's clock at `clock` (call again after an eviction: fields don't survive). */
export function useClock(shard: string, clock: TestClock): Promise<void> {
  return runInDurableObject(shardStub(shard), (instance) => {
    instance.setClock(() => clock.now);
  });
}

/** One loop step, awaited along with the background work it started. */
export function tick(shard: string): Promise<void> {
  return runInDurableObject(shardStub(shard), (instance) => instance.tick());
}

export function playerCount(shard: string): Promise<number> {
  return runInDurableObject(shardStub(shard), (instance) => instance.playerCount);
}

/** RPC calls the web stub received since the last read (vitest.config.ts). */
export async function webCalls(): Promise<unknown[][]> {
  const res = await testEnv.WEB.fetch('https://web.test/__calls');
  return (await res.json()) as unknown[][];
}

export async function setChatMinutes(minutes: number): Promise<void> {
  await testEnv.WEB.fetch('https://web.test/__flags', { method: 'POST', body: String(minutes) });
}

/** A Supabase-shaped access token signed with the auth stub's key. */
export async function token(sub: string, expiresInS = 3600): Promise<string> {
  const key = await importJWK(TEST_JWK, 'ES256');
  const nowS = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: TEST_JWK.kid })
    .setSubject(sub)
    .setIssuer(AUTH_URL)
    .setAudience('authenticated')
    .setIssuedAt(nowS - 60)
    .setExpirationTime(nowS + expiresInS)
    .sign(key);
}

/** cm on the wire for a metres position on the ground. */
export const at = (x: number, z: number, y = 0): [number, number, number] => [
  Math.round(x * 100) || 0,
  Math.round(y * 100) || 0,
  Math.round(z * 100) || 0,
];
