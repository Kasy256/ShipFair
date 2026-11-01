import {
  type AvatarStyleV2,
  type BucketState,
  CHAT_BURST,
  CHAT_INTERVAL_S,
  CLIENT_MAX_MSG_PER_S,
  createBucket,
  EMOTE_PER_S,
  encodeSnapEntry,
  fromNetPos,
  type PlayerSummary,
  TELEPORT_PER_S,
  type TokenBucket,
} from '@shipfair/shared';
import { MOVE_BURST } from '../limits.ts';
import type { RoomConnection } from '../room-connection.ts';

// Per-connection state. `PlayerState` is the whole truth about a player and lives in the
// WebSocket attachment (≤ 2 KB), so a shard evicted while players are connected rebuilds every
// player from it in `onStart`. `Player` adds what is derived or cheap to lose: the buckets as
// objects, metre positions for the grid, and what each recipient was last sent.

/** Between connect and a completed `hello`. */
export interface PendingState {
  readonly kind: 'pending';
  readonly since: number;
}

export interface PlayerState {
  readonly kind: 'player';
  readonly id: number;
  readonly name: string;
  readonly isGuest: boolean;
  readonly uid?: string;
  /** Profile id or guest id: who a booth visit belongs to. */
  readonly key: string;
  readonly avatar: AvatarStyleV2;
  /** Account creation (epoch ms); 0 for guests. */
  readonly createdMs: number;
  /** Last accepted position (cm), yaw (uint16) and anim id. */
  p: [number, number, number];
  r: number;
  a: number;
  /** Server receive time of the last accepted move (never the client's `t`). */
  movedAt: number;
  /** False until the first move: a deep link spawns anywhere inside the city. */
  isPlaced: boolean;
  /** Rate-limit levels at the last save; null before the first one (all buckets start full). */
  buckets: Buckets | null;
  mutedUntil: number;
  strikes: number[];
}

export type ConnState = PendingState | PlayerState;

export interface Buckets {
  move: BucketState;
  emote: BucketState;
  chat: BucketState;
  teleport: BucketState;
}

export class Player {
  readonly conn: RoomConnection<ConnState>;
  readonly state: PlayerState;
  readonly move: TokenBucket;
  readonly emote: TokenBucket;
  readonly chat: TokenBucket;
  readonly teleport: TokenBucket;
  /** Metres, mirrored from `state.p` for the AOI grid and distance checks. */
  x = 0;
  y = 0;
  z = 0;
  /** Bumped whenever p, r or a change; recipients compare it with what they were last sent. */
  version = 1;
  /** Players this one currently has in view (joined, not yet left). */
  readonly aoi = new Set<number>();
  /** Last `version` of each in-view player sent to this one. */
  readonly sent = new Map<number, number>();
  #entry: Uint8Array | null = null;
  #entryVersion = 0;

  constructor(conn: RoomConnection<ConnState>, state: PlayerState) {
    this.conn = conn;
    this.state = state;
    const saved = state.buckets;
    this.move = createBucket(MOVE_BURST, CLIENT_MAX_MSG_PER_S, saved?.move);
    this.emote = createBucket(1, EMOTE_PER_S, saved?.emote);
    this.chat = createBucket(CHAT_BURST, 1 / CHAT_INTERVAL_S, saved?.chat);
    this.teleport = createBucket(1, TELEPORT_PER_S, saved?.teleport);
    this.syncMetres();
  }

  get id(): number {
    return this.state.id;
  }

  syncMetres(): void {
    this.x = fromNetPos(this.state.p[0]);
    this.y = fromNetPos(this.state.p[1]);
    this.z = fromNetPos(this.state.p[2]);
  }

  /** Writes the state (with current bucket levels) to the attachment. */
  save(): void {
    this.state.buckets = {
      move: this.move.state(),
      emote: this.emote.state(),
      chat: this.chat.state(),
      teleport: this.teleport.state(),
    };
    this.conn.setState(this.state);
  }

  /** This player's `snap` entry, packed once per change and shared by every recipient. */
  entryBytes(): Uint8Array {
    if (this.#entry === null || this.#entryVersion !== this.version) {
      const { p, r, a } = this.state;
      this.#entry = encodeSnapEntry([this.state.id, p[0], p[1], p[2], r, a]);
      this.#entryVersion = this.version;
    }
    return this.#entry;
  }

  summary(): PlayerSummary {
    const { id, name, isGuest, uid, avatar, p, r, a } = this.state;
    // `uid` is left out for guests rather than sent as nil, which the schema would refuse.
    return uid === undefined
      ? { id, name, isGuest, avatar, p: [p[0], p[1], p[2]], r, a }
      : { id, name, isGuest, uid, avatar, p: [p[0], p[1], p[2]], r, a };
  }
}
