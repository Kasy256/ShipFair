import type { Teleport } from './protocol.ts';

export type QualityTier = 'high' | 'low';
export type NetStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';
/** Server notices the UI acts on (the rest are handled inside the engine). */
export type NetNoticeCode = 'update_required' | 'banned' | 'kicked' | 'muted';

/** Engine ↔ UI events (ARCHITECTURE.md §3). Payload `undefined` means "no payload". */
export interface EngineEvents {
  // Engine → UI
  /** `districtId: null` is the plaza. */
  'zone:entered': { districtId: number | null };
  /** `boothId: null` clears the prompt. */
  'booth:focus': { boothId: string | null };
  'booth:open': { boothId: string };
  /** A remote player came within range (`isNear`) or left it. `userId` is null for guests. */
  'player:near': { id: number; userId: string | null; isNear: boolean };
  /**
   * A chat line from a player within 15 m (`isYou` for your own echo). `userId` is the sender's
   * profile id (chat is signed-in only), kept for report attachments.
   */
  'chat:incoming': {
    id: number;
    userId: string | null;
    name: string;
    text: string;
    ts: number;
    isYou: boolean;
  };
  /** A remote player was clicked or tapped (the mini profile card). */
  'player:select': { id: number; userId: string | null; name: string; isGuest: boolean };
  /**
   * Makers of live booths among the players you see (`isMakerOf` in their summaries), sent when
   * the list changes. Powers the booth panel's "Maker is here".
   */
  'net:makers': { makers: readonly { id: number; userId: string; boothIds: readonly string[] }[] };
  'net:status': { status: NetStatus; shard: string | null };
  /**
   * Visitors: `nearby` counts you plus everyone the shard shows you (within its 60 m area of
   * interest); `total` is every shard together (pushed by the shard, null until the first push).
   */
  'net:population': { nearby: number; total: number | null };
  /** `until` (epoch ms) is set for `muted` only. */
  'net:notice': { code: NetNoticeCode; message: string; until: number | null };
  /** Booths were approved or changed (`notice:world_update`): refetch the world, then update. */
  'world:changed': { boothIds: string[] };
  'perf:sample': {
    fps: number;
    drawCalls: number;
    triangles: number;
    textureMb: number;
    renderScale: number;
  };
  'ui:open-submit': undefined;
  /** The player stands at the plaza's Just Launched wall (its prompt), or left it. */
  'launches:near': { isNear: boolean };
  /** Interact at the wall: the UI lists the newest booths to jump to. */
  'ui:open-launches': undefined;
  /** An art asset failed to load; the engine uses its placeholder. Sent once per asset id. */
  'asset:missing': { id: string; url: string | null; reason: string };
  // UI → Engine
  emote: { e: number };
  'chat:send': { text: string };
  /** Everyone you muted (profile ids): the shard stops relaying their chat to you. */
  'chat:mutes': { userIds: readonly string[] };
  teleport: Teleport;
  /** Teleport next to a player in your shard ("Walk to maker"). */
  'player:walk-to': { id: number };
  /** You upvoted a booth: a small heart burst at it. */
  'booth:upvoted': { boothId: string };
  'input:enabled': { enabled: boolean };
  'quality:set': { tier: QualityTier };
}

export type Handler<P> = (payload: P) => void;
type EmitArgs<P> = P extends undefined ? [] : [payload: P];

export interface Bus<Events extends object> {
  /** Subscribes and returns the unsubscribe function. */
  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void;
  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void;
  /**
   * Calls every handler, even if one throws, then rethrows the first error so it is never lost.
   * Allocates nothing, so it is safe on per-frame paths.
   */
  emit<K extends keyof Events>(type: K, ...args: EmitArgs<Events[K]>): void;
  clear(): void;
}

export type EventBus = Bus<EngineEvents>;

export function createBus<Events extends object>(): Bus<Events> {
  const handlers = new Map<keyof Events, Set<Handler<never>>>();

  const off: Bus<Events>['off'] = (type, handler) => {
    handlers.get(type)?.delete(handler as Handler<never>);
  };

  return {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler as Handler<never>);
      return () => off(type, handler);
    },
    off,
    // A fixed (type, payload) parameter list, not `...args`, so a call allocates no array.
    emit(type: keyof Events, payload?: unknown) {
      const set = handlers.get(type);
      if (!set) return;
      let failure: unknown;
      let hasFailed = false;
      for (const handler of set) {
        try {
          handler(payload as never);
        } catch (error) {
          if (!hasFailed) failure = error;
          hasFailed = true;
        }
      }
      if (hasFailed) throw failure;
    },
    clear() {
      handlers.clear();
    },
  };
}
