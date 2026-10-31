import { type Connection, Server, type WSMessage } from 'partyserver';
import type { RoomConnection } from './room-connection.ts';

// Our own interface over PartyServer (TECH_STACK.md risks: it is pre-1.0). Rooms see only
// `RoomConnection` and the protected helpers below, so swapping PartyServer for raw Durable Objects
// with the WebSocket Hibernation API means rewriting this file, not the rooms.

export type { RoomConnection } from './room-connection.ts';

const OPEN = 1; // WebSocket.OPEN

function wrap<S>(conn: Connection<S>): RoomConnection<S> {
  return {
    id: conn.id,
    get state() {
      return conn.state as S | null;
    },
    get isOpen() {
      return conn.readyState === OPEN;
    },
    setState: (state) => {
      conn.setState(state);
    },
    send: (data) => {
      if (conn.readyState === OPEN) conn.send(data);
    },
    close: (code, reason) => {
      try {
        conn.close(code, reason);
      } catch {
        // Already closing; nothing to do.
      }
    },
  };
}

/** Text frames are refused by every room; binary arrives as one owned Uint8Array. */
function toBytes(message: WSMessage): Uint8Array | null {
  if (typeof message === 'string') return null;
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
}

export abstract class RoomServer<E extends Cloudflare.Env, S> extends Server<E> {
  // Hibernatable sockets: the object can be evicted while clients stay connected.
  static override options = { hibernate: true };

  // Wrappers are cached per socket id so a room can keep them in maps; rebuilt after hibernation.
  readonly #wrapped = new Map<string, RoomConnection<S>>();

  #wrap(conn: Connection<S>): RoomConnection<S> {
    let room = this.#wrapped.get(conn.id);
    if (!room) {
      room = wrap(conn);
      this.#wrapped.set(conn.id, room);
    }
    return room;
  }

  /** Every open socket in the room, including ones restored after hibernation. */
  protected *connections(): Iterable<RoomConnection<S>> {
    for (const conn of this.getConnections<S>()) yield this.#wrap(conn);
  }

  protected send(conn: RoomConnection<S>, data: Uint8Array): void {
    conn.send(data);
  }

  protected broadcastAll(data: Uint8Array): void {
    this.broadcast(data);
  }

  protected abstract onRoomConnect(conn: RoomConnection<S>): void | Promise<void>;
  /** `data` is null for a text frame. */
  protected abstract onRoomMessage(
    conn: RoomConnection<S>,
    data: Uint8Array | null,
  ): void | Promise<void>;
  protected abstract onRoomClose(conn: RoomConnection<S>): void | Promise<void>;

  override onConnect(conn: Connection): void | Promise<void> {
    return this.onRoomConnect(this.#wrap(conn as Connection<S>));
  }

  override onMessage(conn: Connection, message: WSMessage): void | Promise<void> {
    return this.onRoomMessage(this.#wrap(conn as Connection<S>), toBytes(message));
  }

  override async onClose(conn: Connection): Promise<void> {
    const room = this.#wrap(conn as Connection<S>);
    this.#wrapped.delete(conn.id);
    await this.onRoomClose(room);
  }
}
