import {
  type AvatarStyleV2,
  BoothChange as BoothChangeSchema,
  boothAnchor,
  type CityLayout,
  DEFAULT_AVATAR_STYLE,
  type EngineEvents,
  type Handler,
  spawnBeside,
} from '@shipfair/shared';
import { Vector3 } from 'three';
import { AudioHub } from './audio/audio-hub.ts';
import { loadArt } from './boot-art.ts';
import { CAMERA_FOV_DEG, HEART_Y_M } from './config.ts';
import type { InputAction } from './input/manager.ts';
import type { JoystickView } from './input/touch.ts';
import type { NetConnectOptions } from './net/client.ts';
import { initPhysics } from './physics/world.ts';
import { ScreenRay } from './player/screen-ray.ts';
import { buildRuntime, type Runtime } from './runtime.ts';
import type {
  BoothChange,
  EngineOptions,
  EngineSettings,
  PlayerView,
  QualityTier,
  StartStage,
  Teleport,
  WorldSnapshot,
} from './types.ts';

/** Public surface of the 3D runtime (ARCHITECTURE.md §3). */
export class Engine {
  readonly #options: EngineOptions;
  readonly #unsubscribe: (() => void)[] = [];
  #runtime: Runtime | undefined;
  #quality: QualityTier;
  readonly #audio = new AudioHub();
  #onFrame: ((view: Readonly<PlayerView>) => void) | undefined;
  #isInputEnabled = true;
  /** The local player's look and name tag text, kept across art loading (prompt 07). */
  #style: AvatarStyleV2;
  #playerName: string;
  /** Settings menu values (prompt 14), kept for a runtime that doesn't exist yet. */
  readonly #settings: EngineSettings;
  #isHidden = false;
  #isDisposed = false;
  /** A `connect()` made before `start()` finished; applied once the runtime exists. */
  #net: NetConnectOptions | null = null;
  /** Mutes set before `start()` finished. */
  #mutes: readonly string[] = [];
  readonly #screen: ScreenRay;
  readonly #spot = new Vector3();

  constructor(options: EngineOptions) {
    this.#options = options;
    this.#screen = new ScreenRay(options.canvas);
    this.#quality = options.quality;
    this.#settings = {
      isAutoQuality: options.isAutoQuality !== false,
      renderScale: options.renderScale ?? 1,
      fovDeg: options.fovDeg ?? CAMERA_FOV_DEG,
      volume: options.volume ?? 1,
      isReducedMotion: options.isReducedMotion ?? false,
    };
    this.#audio.setVolume(this.#settings.volume);
    this.#style = options.avatarStyle ?? DEFAULT_AVATAR_STYLE;
    this.#playerName = options.playerName ?? '';
  }

  get canvas(): HTMLCanvasElement {
    return this.#options.canvas;
  }

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  get quality(): QualityTier {
    return this.#quality;
  }

  /** The local player's current style and name (what `setLocalPlayer` last set). */
  get localPlayer(): { readonly style: AvatarStyleV2; readonly name: string } {
    return { style: this.#style, name: this.#playerName };
  }

  /** The city's layout (pure data, no Three.js) for maps. Null before start and in the test level. */
  get layout(): CityLayout | null {
    return this.#runtime?.city?.layout ?? null;
  }

  /** Internals for the in-page test API and the web shell. Undefined before `start()`. */
  get runtime(): Readonly<Runtime> | undefined {
    return this.#runtime;
  }

  /**
   * Boots physics and rendering and builds the city from `world` (`/api/world`, already
   * validated by the caller). Without a snapshot it builds the prompt-04 test level instead,
   * which the movement and collision e2e probes measure against. `onStage` reports progress.
   */
  async start(world?: WorldSnapshot, onStage?: (stage: StartStage) => void): Promise<void> {
    if (this.#runtime || this.#isDisposed) return;
    onStage?.('physics');
    await initPhysics();
    if (this.#isDisposed) return;
    onStage?.('city');
    const options = this.#options;
    const runtime = buildRuntime({
      options,
      world,
      quality: this.#quality,
      style: this.#style,
      settings: this.#settings,
      avatar: () => this.#style,
      lowerTier: (tier) => this.setQuality(tier),
      pick: (x, y) => this.#pick(x, y),
      frame: (view) => this.#onFrame?.(view),
    });
    this.#runtime = runtime;
    const { art, loop, input, physics, renderer, player, multiplayer, background } = runtime;
    art.ready = loadArt(art, {
      bus: options.bus,
      renderer,
      physics,
      player,
      runtime: () => this.#runtime,
      tier: () => this.#quality,
      style: () => this.#style,
    });
    multiplayer.client.setMutes(this.#mutes);
    if (this.#net) multiplayer.connect(this.#net);
    input.setEnabled(this.#isInputEnabled);
    this.#listen();
    loop.advance(0);
    onStage?.('shaders');
    try {
      await renderer.compile();
    } catch (error) {
      // Only a head start: anything not compiled here compiles on first draw.
      console.warn('Shader warm-up failed', error);
    }
    if (this.#isDisposed) return;
    // A tab hidden while loading starts paused; showing it starts the loop.
    if (options.isTestMode !== true) {
      if (this.#isHidden) background.pause();
      else loop.start();
    }
    onStage?.('ready');
  }

  /** Test mode: `n` frames of `dt` seconds with no rAF. Works in live mode too (it adds frames). */
  step(dt: number, n = 1): void {
    this.#runtime?.loop.step(dt, n);
  }

  /** Renders one frame now and returns its counters (test mode never renders on its own). */
  renderOnce(): { calls: number; triangles: number } {
    const runtime = this.#runtime;
    if (!runtime) return { calls: 0, triangles: 0 };
    runtime.renderer.render();
    const { calls, triangles } = runtime.renderer.info.render;
    return { calls, triangles };
  }

  /** An on-screen button press (touch jump / interact). Ignored while input is disabled. */
  press(action: InputAction): void {
    this.#runtime?.input.press(action);
  }

  /** Where to draw the touch joystick. Called on pointer events only, never per frame. */
  onJoystick(listener: ((view: Readonly<JoystickView>) => void) | undefined): void {
    const touch = this.#runtime?.input.touch;
    if (touch) touch.onJoystick = listener;
  }

  /**
   * Adds, changes and removes booths without rebuilding the city. New booths take the next free
   * lot and build up over 1.2 s; existing booths never move. Each change is validated.
   */
  updateBooths(changes: BoothChange[]): void {
    const parsed = changes.map((change) => BoothChangeSchema.parse(change));
    this.#runtime?.city?.apply(parsed);
  }

  /**
   * Moves the player in front of a booth or to a district's gate. Returns false (and stays put)
   * for an unknown slug or before start.
   */
  teleport(to: Teleport): boolean {
    const runtime = this.#runtime;
    const target = runtime?.city?.spawnFor(to);
    if (!runtime || !target) return false;
    runtime.player.teleport(target.x, 0, target.z, target.yaw);
    // The shard lands us at the same spot, so the next move isn't corrected back.
    runtime.multiplayer.client.sendTeleport(to);
    return true;
  }

  /**
   * Moves the player next to another player in the shard ("Walk to maker"), on the side they
   * come from, facing them. Returns false if that player isn't shown.
   */
  walkTo(id: number): boolean {
    const runtime = this.#runtime;
    if (!runtime?.multiplayer.remotes.positionOf(id, this.#spot)) return false;
    const from = runtime.player.controller.position;
    const at = spawnBeside(this.#spot.x, this.#spot.z, from.x, from.z);
    runtime.multiplayer.client.sendTeleport({ kind: 'player', id });
    runtime.player.teleport(at.x, this.#spot.y, at.z, at.yaw);
    return true;
  }

  /**
   * Sends a chat line to everyone within 15 m (signed-in players only; the shard refuses guests).
   * It shows as a bubble and on `chat:incoming` when the shard echoes it back.
   */
  sendChat(text: string): boolean {
    return this.#runtime?.multiplayer.client.sendChat(text) ?? false;
  }

  /** Everyone the player muted (profile ids): their chat is no longer shown or relayed. */
  setMutes(userIds: readonly string[]): void {
    this.#mutes = [...userIds];
    this.#runtime?.multiplayer.client.setMutes(this.#mutes);
  }

  /** The upvote heart burst at a booth (or above the player if the booth isn't in the city). */
  burstHearts(boothId: string): void {
    const runtime = this.#runtime;
    if (!runtime) return;
    const anchor = runtime.city ? boothAnchor(runtime.city.layout, boothId) : null;
    const p = runtime.player.renderPosition;
    if (anchor) runtime.hearts.burst(anchor.x, HEART_Y_M, anchor.z);
    else runtime.hearts.burst(p.x, p.y + HEART_Y_M, p.z);
  }

  /**
   * Picks the remote player under a screen point (client px) and emits `player:select`, or a
   * booth on the Just Launched wall and teleports there. True when something was hit (the click
   * then doesn't lock the pointer or interact).
   */
  #pick(clientX: number, clientY: number): boolean {
    const runtime = this.#runtime;
    const ray = runtime && this.#screen.cast(clientX, clientY, runtime.player.camera.camera);
    if (!runtime || !ray) return false;
    const { origin: o, direction: d } = ray;
    const remotes = runtime.multiplayer.remotes;
    const id = remotes.pick(o.x, o.y, o.z, d.x, d.y, d.z);
    const info = id >= 0 ? remotes.infoOf(id) : null;
    if (info) {
      const { uid: userId, name, isGuest } = info;
      this.#options.bus.emit('player:select', { id, userId, name, isGuest });
      return true;
    }
    // Not a player: maybe a row on the Just Launched wall, which takes you to that booth.
    const slug = runtime.city?.pickWall(o.x, o.y, o.z, d.x, d.y, d.z);
    return slug ? this.teleport({ kind: 'booth', slug }) : false;
  }

  /** Where player `id` appears on screen (client px), or null if not shown (tests click there). */
  screenPositionOf(id: number, heightM = 1.2): { x: number; y: number } | null {
    const runtime = this.#runtime;
    if (!runtime?.multiplayer.remotes.positionOf(id, this.#spot)) return null;
    this.#spot.y += heightM;
    return this.#screen.project(this.#spot, runtime.player.camera.camera);
  }

  /**
   * Called once per frame with the player's position and facing (the minimap). One shared object
   * is passed every time, so nothing is allocated per frame.
   */
  onFrame(listener: ((view: Readonly<PlayerView>) => void) | undefined): void {
    this.#onFrame = listener;
  }

  /** Call from a user gesture (a click): browsers keep audio locked until one happens. */
  unlockAudio(): Promise<boolean> {
    return this.#audio.unlock();
  }

  /**
   * The signed-in user's (or guest's) look and name. Colours change at once; new items or a new
   * body rebuild in the background and swap in. Name tags arrive with remote players (prompt 11);
   * until then the name is only kept here.
   */
  setLocalPlayer(player: { style: AvatarStyleV2; name: string }): void {
    this.#style = player.style;
    this.#playerName = player.name;
    this.#runtime?.player.setStyle(player.style);
  }

  /**
   * Joins the realtime world (the coordinator picks a shard, or `options.shard` for a friend's
   * link). Calling it again reconnects, e.g. after signing in. Connection trouble never stops
   * exploring: the status goes out on `net:status` and the client keeps retrying.
   */
  connect(options: NetConnectOptions): void {
    this.#net = options;
    this.#runtime?.multiplayer.connect(options);
  }

  /** Leaves the realtime world; remote players fade out and the city stays explorable. */
  disconnect(): void {
    this.#net = null;
    this.#runtime?.multiplayer.client.disconnect();
  }

  setInputEnabled(enabled: boolean): void {
    this.#isInputEnabled = enabled;
    this.#runtime?.input.setEnabled(enabled);
  }

  /** The settings menu (prompt 14). Only the values given change; see `EngineSettings`. */
  applySettings(next: Partial<EngineSettings>): void {
    const s = this.#settings;
    s.isAutoQuality = next.isAutoQuality ?? s.isAutoQuality;
    s.renderScale = next.renderScale ?? s.renderScale;
    s.fovDeg = next.fovDeg ?? s.fovDeg;
    s.volume = next.volume ?? s.volume;
    s.isReducedMotion = next.isReducedMotion ?? s.isReducedMotion;
    this.#audio.setVolume(s.volume);
    const runtime = this.#runtime;
    if (!runtime) return;
    // Switching auto resets the adaptive level, so only when it changes.
    if (runtime.perf.adaptive.isAuto !== s.isAutoQuality) runtime.perf.setAuto(s.isAutoQuality);
    runtime.renderer.setUserScale(s.renderScale);
    runtime.renderer.setFov(s.fovDeg);
    runtime.city?.setReducedMotion(s.isReducedMotion);
  }

  get settings(): Readonly<EngineSettings> {
    return this.#settings;
  }

  /**
   * The page was hidden (another tab, the phone locked) or shown again. Hidden: nothing renders
   * and the realtime client only sends heartbeats. Test mode has no loop to stop.
   */
  setHidden(isHidden: boolean): void {
    this.#isHidden = isHidden;
    const runtime = this.#runtime;
    if (!runtime || this.#options.isTestMode === true) return;
    if (isHidden) runtime.background.pause();
    else runtime.background.resume();
  }

  setQuality(tier: QualityTier): void {
    this.#quality = tier;
    this.#runtime?.perf.setTier(tier);
    this.#runtime?.environment.setTier(tier);
    this.#runtime?.city?.setTier(tier);
    this.#runtime?.multiplayer.setTier(tier);
  }

  dispose(): void {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe.length = 0;
    this.#onFrame = undefined;
    this.#audio.dispose();
    const runtime = this.#runtime;
    this.#runtime = undefined;
    if (!runtime) return;
    // Systems go in reverse order of adding (the player's avatar, then input), then the parts
    // the loop doesn't own, and the WebGL renderer last.
    try {
      runtime.background.dispose();
      runtime.loop.dispose();
      runtime.art.stress?.dispose();
      runtime.art.art?.dispose();
    } finally {
      runtime.city?.dispose();
      runtime.level?.dispose();
      runtime.environment.dispose();
      runtime.renderer.scene.clear();
      runtime.renderer.dispose();
    }
  }

  #listen(): void {
    const bus = this.#options.bus;
    const on = <K extends keyof EngineEvents>(type: K, handler: Handler<EngineEvents[K]>) => {
      this.#unsubscribe.push(bus.on(type, handler));
    };
    on('input:enabled', ({ enabled }) => this.setInputEnabled(enabled));
    on('quality:set', ({ tier }) => this.setQuality(tier));
    on('emote', ({ e }) => this.#runtime?.player.emote(e));
    on('teleport', (to) => this.teleport(to));
    on('chat:send', ({ text }) => this.sendChat(text));
    on('chat:mutes', ({ userIds }) => this.setMutes(userIds));
    on('player:walk-to', ({ id }) => this.walkTo(id));
    on('booth:upvoted', ({ boothId }) => this.burstHearts(boothId));
  }
}
