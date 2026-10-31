import {
  BOOTH_VISIT_RADIUS_M,
  type ClientMessage,
  decodeClient,
  encodeServer,
  fromNetPos,
  guestName,
  isProtocolSupported,
  MIN_CLIENT_PROTOCOL,
  migrateAvatarStyle,
  type Notice,
  nearestBooth,
  type PlayerRecord,
  type ServerMessage,
  toNetPos,
  toNetYaw,
  WorldSnapshot,
} from '@shipfair/shared';
import { getServerByName } from 'partyserver';
import { verifyAccessToken } from './auth.ts';
import { type Config, readConfig } from './config.ts';
import type { Env } from './env.ts';
import {
  AOI_CELL_M,
  CLOSE,
  FLAGS_REFRESH_MS,
  HELLO_TIMEOUT_MS,
  INVALID_LIMIT,
  INVALID_WINDOW_MS,
  METRICS_MS,
  POPULATION_PUSH_MS,
  PROFILE_CACHE_MS,
  REPORT_MS,
  STATS_FLUSH_MS,
  TICK_MS,
  WORLD_LOAD_TIMEOUT_MS,
  WORLD_REFRESH_MS,
} from './limits.ts';
import { type RoomConnection, RoomServer } from './room-server.ts';
import { AoiGrid } from './shard/aoi-grid.ts';
import { addStrike, prepareChat } from './shard/chat.ts';
import { ShardMetrics } from './shard/metrics.ts';
import { isInBounds, isReachable, type Vec3 } from './shard/movement.ts';
import { type ConnState, Player, type PlayerState } from './shard/player.ts';
import { horizontalDistSq, stepViews, type ViewSink } from './shard/view.ts';
import { utcDay, VisitTracker } from './shard/visits.ts';
import { WorldView } from './shard/world-view.ts';
import { VisitLedger } from './stats.ts';

// One room of up to MAX_PLAYERS_PER_SHARD players (ARCHITECTURE.md §7). Movement, emotes and chat
// are validated here and relayed within an area of interest by a 10 Hz loop that runs only while
// someone is connected. Every player's state lives in its WebSocket attachment, so the object can
// be evicted (hibernation, deploys) and rebuild the room from its sockets in `onStart`.

const MAX_NET_ID = 65535;

type Hello = Extract<ClientMessage, { type: 'hello' }>;

type Identity =
  | { kind: 'player'; name: string; isGuest: boolean; uid?: string; key: string; createdMs: number }
  | { kind: 'refused'; notice: Notice; code: number; reason: string };

const notice = (n: Notice): Notice => n;

export class WorldShard extends RoomServer<Env, ConnState> {
  readonly #players = new Map<number, Player>();
  readonly #byConn = new Map<string, Player>();
  /**
   * Sockets that haven't finished `hello`, by socket id. Mirrors their attachments (rebuilt in
   * onStart), so the loop never reads attachments, which deserialises them.
   */
  readonly #pending = new Map<
    string,
    { conn: RoomConnection<ConnState>; since: number; isBusy: boolean }
  >();
  readonly #grid = new AoiGrid<Player>(AOI_CELL_M);
  readonly #visits = new VisitTracker();
  readonly #ledger: VisitLedger;
  readonly #metrics: ShardMetrics;
  /** Invalid-message counts per socket: losing them to an eviction only forgives a few. */
  readonly #invalid = new Map<string, { count: number; since: number }>();
  /** Profiles of signed-in players (5 min). Ban status is never cached. */
  readonly #profiles = new Map<
    string,
    { profile: NonNullable<PlayerRecord['profile']>; at: number }
  >();
  #world = WorldView.empty();
  #worldLoad: Promise<void> | null = null;
  #worldCheckedAt = Number.NEGATIVE_INFINITY;
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastTick = 0;
  #lastReport = Number.NEGATIVE_INFINITY;
  #lastPush = 0;
  #lastFlush = 0;
  #lastMetrics = 0;
  #lastFlags = Number.NEGATIVE_INFINITY;
  #isFlushing = false;
  /** Players across all shards, from the coordinator's answer to our last report. */
  #total = 0;
  #newAccountChatMinutes = 0;
  /** Tests replace the clock; everything time-based reads `now()`. */
  #clock: (() => number) | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#ledger = new VisitLedger(ctx.storage.sql);
    this.#metrics = new ShardMetrics(Date.now());
  }

  #config(): Config {
    return readConfig(this.env);
  }

  now(): number {
    return this.#clock ? this.#clock() : Date.now();
  }

  /** Tests only: freeze or step time. */
  setClock(clock: (() => number) | null): void {
    this.#clock = clock;
  }

  get playerCount(): number {
    return this.#players.size;
  }

  // --- lifecycle ---------------------------------------------------------------------------

  // Runs on first start and after every eviction: the room is rebuilt from socket attachments.
  override async onStart(): Promise<void> {
    const now = this.now();
    this.#lastFlush = now;
    this.#lastMetrics = now;
    this.#lastPush = now;
    for (const conn of this.connections()) {
      const state = conn.state;
      if (state?.kind === 'player') this.#addPlayer(new Player(conn, restore(state)));
      // A hello that was in flight is lost with the old instance; the socket times out.
      else if (state?.kind === 'pending') {
        this.#pending.set(conn.id, { conn, since: state.since, isBusy: false });
      }
    }
    if (this.#hasConnections()) this.#startLoop();
    await this.#ensureWorld();
  }

  #startLoop(): void {
    if (this.#timer !== null || this.#config().isManualTick) return;
    this.#timer = setInterval(() => {
      this.tick().catch((error: unknown) => console.error('shard: tick failed', error));
    }, TICK_MS);
  }

  #stopLoop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  #addPlayer(player: Player): void {
    this.#players.set(player.id, player);
    this.#byConn.set(player.conn.id, player);
  }

  protected onRoomConnect(conn: RoomConnection<ConnState>): void {
    const since = this.now();
    conn.setState({ kind: 'pending', since });
    this.#pending.set(conn.id, { conn, since, isBusy: false });
    this.#startLoop(); // the loop also closes sockets that never say hello
  }

  protected async onRoomClose(conn: RoomConnection<ConnState>): Promise<void> {
    this.#invalid.delete(conn.id);
    this.#pending.delete(conn.id);
    const player = this.#byConn.get(conn.id);
    if (player) {
      this.#byConn.delete(conn.id);
      this.#players.delete(player.id);
      this.#visits.forget(player.id);
      // Others drop the player from view on the next tick (`leave`).
    }
    if (!this.#hasConnections()) await this.#emptied();
  }

  #hasConnections(): boolean {
    return this.#players.size > 0 || this.#pending.size > 0;
  }

  /** The last socket left: stop the loop so the object can hibernate, and tidy up. */
  async #emptied(): Promise<void> {
    this.#stopLoop();
    await this.#report(this.now());
    // Visits counted since the last report are flushed by an alarm rather than kept awake for.
    if (this.#ledger.pending().length > 0) {
      await this.ctx.storage.setAlarm(this.#lastFlush + STATS_FLUSH_MS);
    }
  }

  override async onAlarm(): Promise<void> {
    await this.#flushStats(this.now());
  }

  // --- messages ----------------------------------------------------------------------------

  protected async onRoomMessage(
    conn: RoomConnection<ConnState>,
    data: Uint8Array | null,
  ): Promise<void> {
    const now = this.now();
    this.#metrics.msgsIn++;
    const decoded = data ? decodeClient(data) : null;
    if (!decoded?.ok) {
      this.#rejectInvalid(conn, now);
      return;
    }
    const msg = decoded.value;
    const player = this.#byConn.get(conn.id);
    if (msg.type === 'hello') {
      const pending = this.#pending.get(conn.id);
      if (player || !pending || pending.isBusy) {
        this.#rejectInvalid(conn, now);
        return;
      }
      await this.#hello(conn, pending, msg);
      return;
    }
    if (!player) {
      this.#metrics.dropped++; // before hello, or while it is being checked
      return;
    }
    switch (msg.type) {
      case 'move':
        this.#move(player, msg, now);
        return;
      case 'emote':
        this.#emote(player, msg.e, now);
        return;
      case 'chat':
        this.#chat(player, msg.text, now);
        return;
      case 'teleport':
        this.#teleport(player, msg, now);
        return;
      case 'ping':
        this.#send(player.conn, { type: 'pong', t: msg.t });
        return;
    }
  }

  /** Counts and drops an invalid frame; INVALID_LIMIT within INVALID_WINDOW_MS closes the socket. */
  #rejectInvalid(conn: RoomConnection<ConnState>, now: number): void {
    this.#metrics.invalid++;
    let entry = this.#invalid.get(conn.id);
    if (!entry || now - entry.since > INVALID_WINDOW_MS) {
      entry = { count: 0, since: now };
      this.#invalid.set(conn.id, entry);
    }
    entry.count++;
    if (entry.count >= INVALID_LIMIT) conn.close(CLOSE.invalid, 'Too many invalid messages');
  }

  #send(conn: RoomConnection<ConnState>, msg: ServerMessage): number {
    const bytes = encodeServer(msg);
    conn.send(bytes);
    this.#metrics.recordSend(bytes.byteLength);
    return bytes.byteLength;
  }

  #refuse(conn: RoomConnection<ConnState>, n: Notice, code: number, reason: string): void {
    this.#send(conn, n);
    conn.close(code, reason);
  }

  // --- hello -------------------------------------------------------------------------------

  async #hello(
    conn: RoomConnection<ConnState>,
    pending: { isBusy: boolean },
    msg: Hello,
  ): Promise<void> {
    if (msg.v < MIN_CLIENT_PROTOCOL) {
      this.#refuse(
        conn,
        notice({
          type: 'notice',
          code: 'update_required',
          message: 'A new version is out. Refresh to keep exploring.',
        }),
        CLOSE.updateRequired,
        'Update required',
      );
      return;
    }
    if (!isProtocolSupported(msg.v)) {
      conn.close(CLOSE.unsupported, 'Unsupported protocol version');
      return;
    }
    pending.isBusy = true;

    let identity: Identity;
    try {
      identity = msg.token ? await this.#signedIn(msg.token) : guest(msg.guestId ?? '');
    } catch (error) {
      console.error('shard: hello identity check failed', error);
      identity = refusedKicked("We couldn't check your sign-in. Try again in a moment.");
    }
    if (!conn.isOpen) return;
    if (identity.kind === 'refused') {
      this.#refuse(conn, identity.notice, identity.code, identity.reason);
      return;
    }

    await this.#ensureWorld();
    if (!conn.isOpen) return;

    const { maxPlayers } = this.#config().limits;
    if (this.#players.size >= maxPlayers) {
      const shard = await this.#suggestShard();
      this.#refuse(
        conn,
        notice({
          type: 'notice',
          code: 'shard_full',
          message: 'This part of the fair is full.',
          data: { shard },
        }),
        CLOSE.shardFull,
        'Shard full',
      );
      return;
    }

    const now = this.now();
    const spawn = this.#world.layout?.plaza.spawn ?? { x: 0, z: 0, yaw: 0 };
    const state: PlayerState = {
      kind: 'player',
      id: this.#freeId(),
      name: identity.name,
      isGuest: identity.isGuest,
      ...(identity.uid === undefined ? {} : { uid: identity.uid }),
      key: identity.key,
      // Protocol v2 sends the v2 look; a v1 client's flat tints are migrated to the nearest v2.
      avatar: migrateAvatarStyle(msg.avatar),
      createdMs: identity.createdMs,
      p: [toNetPos(spawn.x), 0, toNetPos(spawn.z)],
      r: toNetYaw(spawn.yaw),
      a: 0,
      movedAt: now,
      isPlaced: false,
      buckets: null,
      mutedUntil: 0,
      strikes: [],
    };
    const player = new Player(conn, state);
    this.#pending.delete(conn.id);
    this.#addPlayer(player);
    player.save();
    this.#lastReport = Number.NEGATIVE_INFINITY; // report the new population on the next tick

    const players = [];
    const { aoiRadiusM } = this.#config().limits;
    for (const other of this.#players.values()) {
      if (other === player || horizontalDistSq(player, other) > aoiRadiusM * aoiRadiusM) continue;
      players.push(other.summary());
      player.aoi.add(other.id);
      player.sent.set(other.id, other.version);
    }
    this.#send(conn, { type: 'welcome', you: player.id, shard: this.name, players });
    this.#startLoop();
  }

  async #signedIn(token: string): Promise<Identity> {
    const check = await verifyAccessToken(token, this.#config().jwksUrl);
    if (!check.ok) {
      const text =
        check.reason === 'expired'
          ? 'Your session expired. Sign in again to rejoin.'
          : "We couldn't verify your sign-in. Sign in again to rejoin.";
      return {
        kind: 'refused',
        notice: notice({ type: 'notice', code: 'kicked', message: text }),
        code: CLOSE.unauthorized,
        reason: check.reason,
      };
    }
    const now = this.now();
    const cached = this.#profiles.get(check.userId);
    const isCacheFresh = cached !== undefined && now - cached.at < PROFILE_CACHE_MS;
    const record = await this.env.WEB.getPlayer(check.userId, !isCacheFresh);
    if (!record) return refusedKicked("We couldn't verify your sign-in.");
    if (record.banned) {
      return {
        kind: 'refused',
        notice: notice({
          type: 'notice',
          code: 'banned',
          message: 'This account is banned from ShipFair.',
        }),
        code: CLOSE.banned,
        reason: 'Banned',
      };
    }
    const profile = record.profile ?? (isCacheFresh ? cached.profile : null);
    if (!profile) return refusedKicked('Finish setting up your profile, then rejoin.');
    if (record.profile) this.#profiles.set(check.userId, { profile: record.profile, at: now });
    return {
      kind: 'player',
      name: profile.displayName,
      isGuest: false,
      uid: profile.id,
      key: profile.id,
      createdMs: Date.parse(profile.createdAt) || 0,
    };
  }

  #freeId(): number {
    for (let id = 1; id <= MAX_NET_ID; id++) if (!this.#players.has(id)) return id;
    throw new Error('no free net id'); // unreachable: capacity is far below 65535
  }

  async #suggestShard(): Promise<string> {
    try {
      const coordinator = await getServerByName(this.env.Coordinator, 'main');
      return await coordinator.assign(undefined, this.name);
    } catch (error) {
      console.error('shard: no suggestion from the coordinator', error);
      return 'w-1';
    }
  }

  // --- movement ----------------------------------------------------------------------------

  #move(player: Player, msg: Extract<ClientMessage, { type: 'move' }>, now: number): void {
    if (!player.move.take(now)) {
      this.#metrics.dropped++;
      return;
    }
    const to: Vec3 = { x: fromNetPos(msg.p[0]), y: fromNetPos(msg.p[1]), z: fromNetPos(msg.p[2]) };
    const { state } = player;
    const elapsedS = (now - state.movedAt) / 1000;
    const isValid =
      isInBounds(this.#world.bounds, to) && (!state.isPlaced || isReachable(player, to, elapsedS));
    if (!isValid) {
      this.#metrics.clamped++;
      this.#send(player.conn, {
        type: 'notice',
        code: 'correct',
        message: 'Position corrected',
        data: { p: [state.p[0], state.p[1], state.p[2]], r: state.r },
      });
      return;
    }
    const changed =
      state.p[0] !== msg.p[0] ||
      state.p[1] !== msg.p[1] ||
      state.p[2] !== msg.p[2] ||
      state.r !== msg.r ||
      state.a !== msg.a;
    state.p = [msg.p[0], msg.p[1], msg.p[2]];
    state.r = msg.r;
    state.a = msg.a;
    state.movedAt = now;
    state.isPlaced = true;
    if (changed) {
      player.version++;
      player.syncMetres();
    }
    player.save();
  }

  #teleport(player: Player, msg: Extract<ClientMessage, { type: 'teleport' }>, now: number): void {
    if (!player.teleport.take(now)) {
      this.#metrics.dropped++;
      return;
    }
    const target = this.#world.teleportTarget(msg.to);
    if (!target) {
      this.#metrics.dropped++;
      return;
    }
    const { state } = player;
    state.p = [toNetPos(target.x), 0, toNetPos(target.z)];
    state.r = toNetYaw(target.yaw);
    state.movedAt = now;
    state.isPlaced = true;
    player.version++;
    player.syncMetres();
    player.save();
  }

  // --- emotes and chat ---------------------------------------------------------------------

  #emote(player: Player, e: number, now: number): void {
    if (!player.emote.take(now)) {
      this.#metrics.dropped++;
      return;
    }
    const bytes = encodeServer({ type: 'emote', id: player.id, e });
    const { aoiRadiusM } = this.#config().limits;
    for (const other of this.#players.values()) {
      if (other === player || horizontalDistSq(player, other) > aoiRadiusM * aoiRadiusM) continue;
      other.conn.send(bytes);
      this.#metrics.recordSend(bytes.byteLength);
    }
  }

  #chat(player: Player, raw: string, now: number): void {
    const { state } = player;
    if (state.isGuest) {
      this.#metrics.dropped++; // guests can walk and emote, not chat (TRUST_AND_SAFETY.md)
      return;
    }
    const allowedFrom = Math.max(
      state.mutedUntil,
      state.createdMs + this.#newAccountChatMinutes * 60_000,
    );
    if (now < allowedFrom) {
      this.#metrics.dropped++;
      this.#send(player.conn, {
        type: 'notice',
        code: 'muted',
        message: "You can't chat yet.",
        data: { until: allowedFrom },
      });
      return;
    }
    if (!player.chat.take(now)) {
      this.#metrics.dropped++;
      return;
    }
    const prepared = prepareChat(raw);
    if (!prepared) {
      player.save();
      return;
    }
    if (prepared.isFiltered) {
      const strike = addStrike(state.strikes, now);
      state.strikes = strike.strikes;
      if (strike.mutedUntil > 0) {
        state.mutedUntil = strike.mutedUntil;
        this.#send(player.conn, {
          type: 'notice',
          code: 'muted',
          message: 'You are muted for 10 minutes for repeated filtered messages.',
          data: { until: strike.mutedUntil },
        });
      }
    }
    player.save();
    const bytes = encodeServer({ type: 'chat', id: player.id, text: prepared.text, ts: now });
    const { chatRadiusM } = this.#config().limits;
    for (const other of this.#players.values()) {
      if (horizontalDistSq(player, other) > chatRadiusM * chatRadiusM) continue;
      other.conn.send(bytes);
      this.#metrics.recordSend(bytes.byteLength);
    }
  }

  // --- the loop ----------------------------------------------------------------------------

  /**
   * One 10 Hz step: AOI snapshots, joins and leaves, visit dwell, and the periodic jobs. Returns
   * when the background work it started (reports, stats, world reloads) has settled, which the
   * interval ignores and tests await.
   */
  async tick(): Promise<void> {
    const started = performance.now();
    const now = this.now();
    const dtS = this.#lastTick > 0 ? Math.min(Math.max((now - this.#lastTick) / 1000, 0), 1) : 0;
    this.#lastTick = now;

    this.#closeSilentSockets(now);
    stepViews(
      this.#playerList(),
      this.#grid,
      this.#config().limits.aoiRadiusM,
      now,
      this.#viewSink,
    );
    this.#trackVisits(now, dtS);

    const jobs: Promise<unknown>[] = [];
    if (now - this.#lastReport >= REPORT_MS) jobs.push(this.#report(now));
    if (now - this.#lastPush >= POPULATION_PUSH_MS) this.#pushPopulation(now);
    if (now - this.#lastFlush >= STATS_FLUSH_MS) jobs.push(this.#flushStats(now));
    if (now - this.#worldCheckedAt >= WORLD_REFRESH_MS) jobs.push(this.#loadWorld());
    if (now - this.#lastFlags >= FLAGS_REFRESH_MS) jobs.push(this.#loadFlags(now));
    if (now - this.#lastMetrics >= METRICS_MS) this.#logMetrics(now);
    this.#metrics.recordTick(performance.now() - started);

    if (!this.#hasConnections()) this.#stopLoop();
    await Promise.allSettled(jobs);
  }

  /** The players as an array, reused between ticks (stepViews walks it twice). */
  #playerList(): Player[] {
    const list = this.#list;
    list.length = 0;
    for (const player of this.#players.values()) list.push(player);
    return list;
  }

  readonly #list: Player[] = [];

  readonly #viewSink: ViewSink = {
    send: (to, msg) => this.#send(to.conn, msg),
    sendBytes: (to, bytes) => {
      to.conn.send(bytes);
      this.#metrics.recordSend(bytes.byteLength);
    },
    snapSent: (entries, bytes) => this.#metrics.recordSnap(entries, bytes),
  };

  #closeSilentSockets(now: number): void {
    for (const pending of this.#pending.values()) {
      if (!pending.isBusy && now - pending.since > HELLO_TIMEOUT_MS) {
        pending.conn.close(CLOSE.helloTimeout, 'No hello');
      }
    }
  }

  #trackVisits(now: number, dtS: number): void {
    const layout = this.#world.layout;
    if (!layout) return;
    const day = utcDay(now);
    for (const player of this.#players.values()) {
      const booth = nearestBooth(layout, player.x, player.z, BOOTH_VISIT_RADIUS_M);
      this.#visits.update(
        player.id,
        player.state.key,
        booth?.boothId ?? null,
        dtS,
        day,
        this.#ledger,
      );
    }
  }

  // --- periodic jobs -----------------------------------------------------------------------

  async #report(now: number): Promise<void> {
    this.#lastReport = now;
    try {
      const coordinator = await getServerByName(this.env.Coordinator, 'main');
      const { total } = await coordinator.report(this.name, this.#players.size);
      this.#total = total;
    } catch (error) {
      console.error('shard: population report failed', error);
    }
  }

  #pushPopulation(now: number): void {
    this.#lastPush = now;
    if (this.#players.size === 0) return;
    const bytes = encodeServer({
      type: 'notice',
      code: 'population',
      message: 'Visitors right now',
      data: { shard: this.#players.size, total: Math.max(this.#total, this.#players.size) },
    });
    for (const player of this.#players.values()) {
      player.conn.send(bytes);
      this.#metrics.recordSend(bytes.byteLength);
    }
  }

  /** Sends visit counts to the web Worker: one `ingestStats` call per STATS_FLUSH_MS at most. */
  async #flushStats(now: number): Promise<void> {
    this.#lastFlush = now;
    this.#ledger.prune(now);
    if (this.#isFlushing) return;
    const rows = this.#ledger.pending();
    if (rows.length === 0) return;
    this.#isFlushing = true;
    try {
      const result = await this.env.WEB.ingestStats({
        shard: this.name,
        secret: this.#config().statsSecret,
        rows,
      });
      if (result.ok) this.#ledger.settle(rows);
      else console.error('shard: stats refused', result.error);
    } catch (error) {
      console.error('shard: stats flush failed', error);
    } finally {
      this.#isFlushing = false;
    }
  }

  async #loadFlags(now: number): Promise<void> {
    this.#lastFlags = now;
    try {
      this.#newAccountChatMinutes = (await this.env.WEB.flags()).NEW_ACCOUNT_CHAT_MINUTES;
    } catch (error) {
      console.error('shard: flags unavailable', error);
    }
  }

  #logMetrics(now: number): void {
    this.#lastMetrics = now;
    const report = this.#metrics.take(this.name, this.#players.size, now);
    console.log(JSON.stringify({ event: 'shard_metrics', ...report }));
  }

  // --- the world ---------------------------------------------------------------------------

  /** Reloads `/api/world` (one load at a time). Keeps the current view if the web is down. */
  #loadWorld(): Promise<void> {
    if (this.#worldLoad) return this.#worldLoad;
    this.#worldCheckedAt = this.now();
    this.#worldLoad = (async () => {
      try {
        const raw = await this.env.WEB.world();
        const snapshot = WorldSnapshot.safeParse(raw);
        if (!snapshot.success) {
          console.error('shard: world unavailable or invalid');
          return;
        }
        if (snapshot.data.version !== this.#world.version)
          this.#world = WorldView.from(snapshot.data);
      } catch (error) {
        console.error('shard: world load failed', error);
      } finally {
        this.#worldLoad = null;
      }
    })();
    return this.#worldLoad;
  }

  /** Waits for a first world (bounded), so early moves are checked against the real city. */
  async #ensureWorld(): Promise<void> {
    if (this.#world.isLoaded) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, WORLD_LOAD_TIMEOUT_MS);
    });
    await Promise.race([this.#loadWorld(), timeout]);
    clearTimeout(timer);
  }

  // --- internal RPC (DO stub calls from RealtimeRpc) ---------------------------------------

  /** Booths changed: reload the world, then tell players which booths to refetch. */
  async worldUpdate(boothIds: readonly string[]): Promise<number> {
    this.#worldCheckedAt = Number.NEGATIVE_INFINITY;
    await this.#loadWorld();
    if (this.#players.size === 0) return 0;
    const bytes = encodeServer({
      type: 'notice',
      code: 'world_update',
      message: 'The city changed',
      data: { boothIds: [...boothIds] },
    });
    for (const player of this.#players.values()) {
      player.conn.send(bytes);
      this.#metrics.recordSend(bytes.byteLength);
    }
    return this.#players.size;
  }

  /** Closes every socket of `userId` with `notice:banned` (or `kicked`). Returns how many. */
  kick(userId: string, code: string): number {
    const isBan = code === 'banned';
    let closed = 0;
    for (const player of [...this.#players.values()]) {
      if (player.state.uid !== userId) continue;
      this.#refuse(
        player.conn,
        isBan
          ? notice({
              type: 'notice',
              code: 'banned',
              message: 'This account is banned from ShipFair.',
            })
          : notice({ type: 'notice', code: 'kicked', message: 'You were removed from the fair.' }),
        isBan ? CLOSE.banned : CLOSE.kicked,
        isBan ? 'Banned' : 'Kicked',
      );
      closed++;
    }
    return closed;
  }
}

function guest(guestId: string): Identity {
  return {
    kind: 'player',
    name: guestName(guestId),
    isGuest: true,
    key: `guest:${guestId}`,
    createdMs: 0,
  };
}

function refusedKicked(message: string): Identity {
  return {
    kind: 'refused',
    notice: notice({ type: 'notice', code: 'kicked', message }),
    code: CLOSE.unauthorized,
    reason: 'Unauthorized',
  };
}

/** An attachment is a deserialised copy; give the room its own mutable state. */
function restore(state: PlayerState): PlayerState {
  return {
    ...state,
    // Attachments saved by the protocol-v1 build hold a v1 look.
    avatar: migrateAvatarStyle(state.avatar),
    p: [state.p[0], state.p[1], state.p[2]],
    strikes: [...state.strikes],
  };
}
