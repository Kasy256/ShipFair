import { CoordinatorJoin } from '@shipfair/shared';
import { PartySocket } from 'partysocket';
import { NET_CONNECT_TIMEOUT_MS, NET_RECONNECT_MAX_MS, NET_RECONNECT_MIN_MS } from '../config.ts';

// The two network edges of the realtime client: the coordinator's `join` call and the shard
// WebSocket. `NetClient` only sees `SocketLike`, so its tests run without a network.

/**
 * Closes that mean "don't come back": update required (4000), unsupported protocol (4002),
 * banned (4003), kicked (4004), invalid flood (4005), unauthorised (4401). Everything else (a
 * dropped connection, a restarted server, 4001 shard full, 4408 no hello) reconnects.
 */
export const TERMINAL_CLOSES: ReadonlySet<number> = new Set([4000, 4002, 4003, 4004, 4005, 4401]);

export interface SocketLike {
  readonly isOpen: boolean;
  /** Failed attempts since the last open (partysocket's backoff counter). */
  readonly retryCount: number;
  onOpen: () => void;
  onMessage: (data: ArrayBuffer) => void;
  onClose: (code: number) => void;
  send(bytes: Uint8Array): void;
  /** Reconnects to another shard (after `shard_full`) on the next attempt. */
  moveTo(shard: string): void;
  close(code: number, reason: string): void;
}

/** `GET /parties/coordinator/main/join[?shard=]` → the shard to connect to. */
export async function joinShard(
  host: string,
  isLocal: boolean,
  shard: string | null,
): Promise<string> {
  const query = shard ? `?shard=${encodeURIComponent(shard)}` : '';
  const url = `${isLocal ? 'http' : 'https'}://${host}/parties/coordinator/main/join${query}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(NET_CONNECT_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`coordinator answered ${response.status}`);
  return CoordinatorJoin.parse(await response.json()).shard;
}

/** A partysocket to `/parties/world-shard/<shard>` with backoff and no message queue. */
export function openSocket(opts: { host: string; isSecure: boolean; shard: string }): SocketLike {
  const socket = new PartySocket({
    host: opts.host,
    protocol: opts.isSecure ? 'wss' : 'ws',
    party: 'world-shard',
    room: opts.shard,
    minReconnectionDelay: NET_RECONNECT_MIN_MS,
    maxReconnectionDelay: NET_RECONNECT_MAX_MS,
    connectionTimeout: NET_CONNECT_TIMEOUT_MS,
    // Moves are only worth sending now; nothing is queued while the socket is down.
    maxEnqueuedMessages: 0,
    shouldReconnectOnClose: (event) => !TERMINAL_CLOSES.has(event.code),
  });
  socket.binaryType = 'arraybuffer';
  const wrapper: SocketLike = {
    get isOpen() {
      return socket.readyState === WebSocket.OPEN;
    },
    get retryCount() {
      return socket.retryCount;
    },
    onOpen: () => {},
    onMessage: () => {},
    onClose: () => {},
    // encodeClient returns a copy that owns its ArrayBuffer (protocol.ts), so the cast is safe.
    send: (bytes) => socket.send(bytes as Uint8Array<ArrayBuffer>),
    moveTo: (shard) => socket.updateProperties({ room: shard }),
    close: (code, reason) => socket.close(code, reason),
  };
  socket.addEventListener('open', () => wrapper.onOpen());
  socket.addEventListener('message', (event) => {
    if (event.data instanceof ArrayBuffer) wrapper.onMessage(event.data);
  });
  socket.addEventListener('close', (event) => wrapper.onClose(event.code));
  return wrapper;
}
