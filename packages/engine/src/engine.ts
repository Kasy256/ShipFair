import { DEFAULT_AVATAR_STYLE, type EngineEvents, type Handler } from '@shipfair/shared';
import { Loop } from './core/loop.ts';
import { PerfOverlay } from './debug/perf-overlay.ts';
import { PhysicsWireframe } from './debug/physics-wireframe.ts';
import { type InputAction, InputManager } from './input/manager.ts';
import type { JoystickView } from './input/touch.ts';
import { initPhysics, PhysicsWorld } from './physics/world.ts';
import { PlayerSystem } from './player/player-system.ts';
import { PerfSystem } from './quality/perf-system.ts';
import { Renderer } from './render/renderer.ts';
import type { BoothChange, EngineOptions, QualityTier, Teleport, WorldSnapshot } from './types.ts';
import { Environment } from './world/environment.ts';
import { type BuiltLevel, buildTestLevel } from './world/test-level.ts';
import { type TestLevelLayout, testLevelLayout } from './world/test-level-layout.ts';

/** Everything that exists between `start()` and `dispose()`. */
interface Runtime {
  loop: Loop;
  input: InputManager;
  physics: PhysicsWorld;
  renderer: Renderer;
  environment: Environment;
  level: BuiltLevel;
  layout: TestLevelLayout;
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
   * Boots physics and rendering and builds the world. Until prompt 05 the world is always the
   * test level and `world` is ignored.
   */
  async start(_world?: WorldSnapshot): Promise<void> {
    if (this.#runtime || this.#isDisposed) return;
    await initPhysics();
    if (this.#isDisposed) return;
    const options = this.#options;
    const debug = options.debug ?? new Set();
    const loop = new Loop();
    const input = loop.add(new InputManager(options.canvas));
    const physics = new PhysicsWorld();
    const layout = testLevelLayout();
    const level = buildTestLevel(layout, physics);
    const style = options.avatarStyle ?? DEFAULT_AVATAR_STYLE;
    const player = loop.add(new PlayerSystem(physics, input.state, loop, layout.spawn, style));
    loop.add(physics);
    const renderer = new Renderer(options.canvas, player.camera.camera, this.#quality);
    const environment = new Environment(renderer.renderer, renderer.scene);
    renderer.scene.add(...level.root, player.avatar.object);
    const onBenchmarkTier = options.isAutoQuality === false ? undefined : this.#lowerTier;
    const perf = loop.add(
      new PerfSystem(loop, renderer, options.bus, this.#quality, onBenchmarkTier),
    );
    loop.add({ update: () => environment.follow(player.renderPosition), dispose() {} });
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

    this.#runtime = { loop, input, physics, renderer, environment, level, layout, player, perf };
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

  updateBooths(_changes: BoothChange[]): void {
    throw notImplemented('updateBooths');
  }

  teleport(_to: Teleport): void {
    throw notImplemented('teleport');
  }

  setInputEnabled(enabled: boolean): void {
    this.#isInputEnabled = enabled;
    this.#runtime?.input.setEnabled(enabled);
  }

  setQuality(tier: QualityTier): void {
    this.#quality = tier;
    this.#runtime?.perf.setTier(tier);
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
    } finally {
      runtime.level.dispose();
      runtime.environment.dispose();
      runtime.renderer.scene.clear();
      runtime.renderer.dispose();
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
  }
}

function notImplemented(method: string): Error {
  return new Error(`Engine.${method}: not implemented until prompt 05`);
}
