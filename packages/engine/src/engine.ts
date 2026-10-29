import {
  type AvatarStyleV2,
  BoothChange as BoothChangeSchema,
  DEFAULT_AVATAR_STYLE,
  type EngineEvents,
  type Handler,
} from '@shipfair/shared';
import { Art } from './art.ts';
import { GltfAvatar } from './avatars/gltf-avatar.ts';
import { Loop } from './core/loop.ts';
import { PerfOverlay } from './debug/perf-overlay.ts';
import { PhysicsWireframe } from './debug/physics-wireframe.ts';
import { StressScene } from './debug/stress.ts';
import { type InputAction, InputManager } from './input/manager.ts';
import type { JoystickView } from './input/touch.ts';
import { initPhysics, PhysicsWorld } from './physics/world.ts';
import { PlayerSystem } from './player/player-system.ts';
import { PerfSystem } from './quality/perf-system.ts';
import { Renderer } from './render/renderer.ts';
import type { BoothChange, EngineOptions, QualityTier, Teleport, WorldSnapshot } from './types.ts';
import { City } from './world/city.ts';
import { Environment } from './world/environment.ts';
import { type BuiltLevel, buildTestLevel } from './world/test-level.ts';
import { type TestLevelLayout, testLevelLayout } from './world/test-level-layout.ts';

/** Art arrives after `start()`; until then (or without it) placeholders are used. */
export interface ArtHost {
  art: Art | null;
  stress: StressScene | null;
  /** Resolves once art has loaded and the local avatar is swapped (null if art failed). */
  ready: Promise<Art | null>;
}

/** Everything that exists between `start()` and `dispose()`. */
interface Runtime {
  art: ArtHost;
  loop: Loop;
  input: InputManager;
  physics: PhysicsWorld;
  renderer: Renderer;
  environment: Environment;
  /** The city built from the snapshot (null in the prompt-04 test level). */
  city: City | null;
  /** The prompt-04 test level, used when `start()` gets no snapshot. */
  level: BuiltLevel | null;
  layout: TestLevelLayout | null;
  player: PlayerSystem;
  perf: PerfSystem;
}

/** Public surface of the 3D runtime (ARCHITECTURE.md §3). */
export class Engine {
  readonly #options: EngineOptions;
  readonly #unsubscribe: (() => void)[] = [];
  #runtime: Runtime | undefined;
  #quality: QualityTier;
  #isInputEnabled = true;
  #isDisposed = false;

  constructor(options: EngineOptions) {
    this.#options = options;
    this.#quality = options.quality;
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

  /** Internals for the in-page test API and the web shell. Undefined before `start()`. */
  get runtime(): Readonly<Runtime> | undefined {
    return this.#runtime;
  }

  /**
   * Boots physics and rendering and builds the city from `world` (`/api/world`, already
   * validated by the caller). Without a snapshot it builds the prompt-04 test level instead,
   * which the movement and collision e2e probes measure against.
   */
  async start(world?: WorldSnapshot): Promise<void> {
    if (this.#runtime || this.#isDisposed) return;
    await initPhysics();
    if (this.#isDisposed) return;
    const options = this.#options;
    const debug = options.debug ?? new Set();
    const loop = new Loop();
    const input = loop.add(new InputManager(options.canvas));
    const physics = new PhysicsWorld();
    const layout = world ? null : testLevelLayout();
    const level = layout ? buildTestLevel(layout, physics) : null;
    const spawn = layout ? layout.spawn : { x: 0, y: 0, z: 0, yaw: 0 };
    const style = options.avatarStyle ?? DEFAULT_AVATAR_STYLE;
    const player = loop.add(new PlayerSystem(physics, input.state, loop, spawn, style));
    loop.add(physics);
    const renderer = new Renderer(options.canvas, player.camera.camera, this.#quality);
    const environment = new Environment(renderer.renderer, renderer.scene, this.#quality);
    const city = world
      ? new City({
          snapshot: world,
          physics,
          bus: options.bus,
          environment,
          viewer: player.camera.camera.position,
          player: player.renderPosition,
          tier: this.#quality,
          mediaHost: options.mediaHost ?? null,
        })
      : null;
    if (city) {
      const { x, z, yaw } = city.spawn;
      player.teleport(x, 0, z, yaw);
      renderer.scene.add(city.root);
      player.onInteract = () => city.interact();
    }
    if (level) renderer.scene.add(...level.root);
    renderer.scene.add(player.avatar.object);
    const onBenchmarkTier = options.isAutoQuality === false ? undefined : this.#lowerTier;
    const perf = loop.add(
      new PerfSystem(loop, renderer, options.bus, this.#quality, onBenchmarkTier),
    );
    perf.textureBytes = () => city?.textureBytes ?? 0;
    loop.add({
      update: (dt) => environment.follow(player.renderPosition, dt),
      dispose() {},
    });
    if (city) loop.add({ update: (dt) => city.update(dt), dispose() {} });
    const art: ArtHost = { art: null, stress: null, ready: Promise.resolve(null) };
    loop.add({ update: (dt) => art.stress?.update(dt), dispose() {} });
    if (debug.has('physics')) loop.add(new PhysicsWireframe(physics, renderer.scene));
    if (debug.has('perf')) {
      const parent = options.canvas.parentElement ?? document.body;
      loop.add(new PerfOverlay(parent, loop, renderer.info, () => renderer.renderScale));
    }
    // Rendering is the last thing every frame, but the renderer is disposed by the engine, after
    // everything that owns GPU resources has released them.
    loop.add({ update: (dt) => renderer.update(dt), dispose() {} });
    // One step lets Rapier's broad phase see the level before the first camera ray.
    physics.world.step();
    renderer.isAutoRendering = options.isTestMode !== true;

    this.#runtime = {
      art,
      loop,
      input,
      physics,
      renderer,
      environment,
      city,
      level,
      layout,
      player,
      perf,
    };
    art.ready = this.#loadArt(art, renderer, physics, player, style);
    input.setEnabled(this.#isInputEnabled);
    this.#listen();
    loop.advance(0);
    if (options.isTestMode !== true) loop.start();
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

  /** Moves the player in front of a booth or into a district. Unknown slugs are ignored. */
  teleport(to: Teleport): void {
    const runtime = this.#runtime;
    const target = runtime?.city?.spawnFor(to);
    if (!runtime || !target) return;
    runtime.player.teleport(target.x, 0, target.z, target.yaw);
  }

  setInputEnabled(enabled: boolean): void {
    this.#isInputEnabled = enabled;
    this.#runtime?.input.setEnabled(enabled);
  }

  setQuality(tier: QualityTier): void {
    this.#quality = tier;
    this.#runtime?.perf.setTier(tier);
    this.#runtime?.environment.setTier(tier);
    this.#runtime?.city?.setTier(tier);
  }

  dispose(): void {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe.length = 0;
    const runtime = this.#runtime;
    this.#runtime = undefined;
    if (!runtime) return;
    // Systems go in reverse order of adding (the player's avatar, then input), then the parts
    // the loop doesn't own, and the WebGL renderer last.
    try {
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

  /**
   * Loads built art in the background. The procedural avatar stays until a real body and its
   * clips are ready; any failure keeps the placeholders (each piece reports `asset:missing`).
   */
  async #loadArt(
    host: ArtHost,
    renderer: Renderer,
    physics: PhysicsWorld,
    player: PlayerSystem,
    style: AvatarStyleV2,
  ): Promise<Art | null> {
    try {
      const art = await Art.load(this.#options.bus, renderer.renderer);
      if (this.#isDisposed) {
        art.dispose();
        return null;
      }
      host.art = art;
      this.#runtime?.city?.attachArt(art);
      host.stress = new StressScene(
        art,
        renderer.scene,
        physics,
        player.camera.camera.position,
        () => this.#quality,
      );
      const factory = art.factory;
      if (factory && art.canBuildCharacters(`body_${style.body}`)) {
        const avatar = await GltfAvatar.create(factory, art.animations, style, 0);
        // After dispose the art (and so this avatar's geometry) is already released.
        if (this.#isDisposed) avatar.dispose();
        else player.setAvatar(avatar);
      }
      return art;
    } catch (error) {
      console.error('Art failed to load; the game keeps its placeholders.', error);
      return null;
    }
  }

  readonly #lowerTier = (tier: QualityTier): void => {
    this.setQuality(tier);
  };

  #listen(): void {
    const bus = this.#options.bus;
    const on = <K extends keyof EngineEvents>(type: K, handler: Handler<EngineEvents[K]>) => {
      this.#unsubscribe.push(bus.on(type, handler));
    };
    on('input:enabled', ({ enabled }) => this.setInputEnabled(enabled));
    on('quality:set', ({ tier }) => this.setQuality(tier));
    on('emote', ({ e }) => this.#runtime?.player.avatar.playEmote(e));
    on('teleport', (to) => this.teleport(to));
  }
}
