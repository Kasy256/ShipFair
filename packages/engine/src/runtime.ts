import type { AvatarStyleV2, QualityTier, WorldSnapshot } from '@shipfair/shared';
import type { ArtHost } from './boot-art.ts';
import { BackgroundPause } from './core/background.ts';
import { Loop } from './core/loop.ts';
import { PerfOverlay } from './debug/perf-overlay.ts';
import { PhysicsWireframe } from './debug/physics-wireframe.ts';
import { InputManager } from './input/manager.ts';
import { Multiplayer } from './net/multiplayer.ts';
import { PhysicsWorld } from './physics/world.ts';
import { PlayerSystem } from './player/player-system.ts';
import { PerfSystem } from './quality/perf-system.ts';
import { Renderer } from './render/renderer.ts';
import type { EngineOptions, EngineSettings, PlayerView } from './types.ts';
import { City } from './world/city.ts';
import { Environment } from './world/environment.ts';
import { HeartBurst } from './world/heart-burst.ts';
import { type BuiltLevel, buildTestLevel } from './world/test-level.ts';
import { type TestLevelLayout, testLevelLayout } from './world/test-level-layout.ts';

/** Everything that exists between `start()` and `dispose()`. */
export interface Runtime {
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
  multiplayer: Multiplayer;
  /** The upvote heart burst (prompt 12). */
  hearts: HeartBurst;
  /** Stops rendering while the tab is hidden (prompt 14). */
  background: BackgroundPause;
}

/** What the engine knows when it builds the runtime, and how the runtime calls back into it. */
export interface RuntimeParams {
  options: EngineOptions;
  /** Undefined builds the prompt-04 test level. */
  world: WorldSnapshot | undefined;
  quality: QualityTier;
  style: AvatarStyleV2;
  settings: Readonly<EngineSettings>;
  /** The local player's look now (multiplayer sends it on every hello). */
  avatar: () => AvatarStyleV2;
  /** The boot benchmark asks for a lower tier (only while quality is automatic). */
  lowerTier: (tier: QualityTier) => void;
  /** A click or tap at client px; true when it hit something. */
  pick: (clientX: number, clientY: number) => boolean;
  /** Once per frame, after the player and camera moved. One reused object: read it, don't keep it. */
  frame: (view: Readonly<PlayerView>) => void;
}

/**
 * Builds the systems in loop order: input, player, physics, perf, remote players, effects, debug
 * overlays, the per-frame report, then rendering last. Physics must be initialised first.
 */
export function buildRuntime(p: RuntimeParams): Runtime {
  const { options, world, quality, settings } = p;
  const debug = options.debug ?? new Set();
  const loop = new Loop();
  const input = loop.add(new InputManager(options.canvas));
  const physics = new PhysicsWorld();
  const layout = world ? null : testLevelLayout();
  const level = layout ? buildTestLevel(layout, physics) : null;
  const spawn = layout ? layout.spawn : { x: 0, y: 0, z: 0, yaw: 0 };
  const player = loop.add(new PlayerSystem(physics, input.state, loop, spawn, p.style));
  loop.add(physics);
  const renderer = new Renderer(options.canvas, player.camera.camera, quality);
  renderer.setUserScale(settings.renderScale);
  renderer.setFov(settings.fovDeg);
  const environment = new Environment(renderer.renderer, renderer.scene, quality);
  const city = world
    ? new City({
        snapshot: world,
        physics,
        bus: options.bus,
        environment,
        viewer: player.camera.camera.position,
        player: player.renderPosition,
        tier: quality,
        mediaHost: options.mediaHost ?? null,
      })
    : null;
  if (city) {
    city.setReducedMotion(settings.isReducedMotion);
    const { x, z, yaw } = city.spawn;
    player.teleport(x, 0, z, yaw);
    renderer.scene.add(city.root);
    player.onInteract = () => city.interact();
  }
  if (level) renderer.scene.add(...level.root);
  renderer.scene.add(player.avatar.object);
  const perf = loop.add(
    new PerfSystem(
      loop,
      renderer,
      options.bus,
      quality,
      settings.isAutoQuality ? p.lowerTier : undefined,
      settings.isAutoQuality,
    ),
  );
  const multiplayer = new Multiplayer({
    loop,
    bus: options.bus,
    scene: renderer.scene,
    player,
    city,
    viewer: player.camera.camera.position,
    tier: quality,
    avatar: p.avatar,
  });
  perf.textureBytes = () => (city?.textureBytes ?? 0) + multiplayer.remotes.textureBytes;
  perf.onSettings = (settings) => {
    city?.setStreamRadius(settings.streamRadiusM);
    multiplayer.remotes.nameTagDistanceM = settings.nameTagDistanceM;
  };
  const background = new BackgroundPause(loop, (dt) => multiplayer.client.update(dt));
  const hearts = loop.add(new HeartBurst());
  renderer.scene.add(hearts.mesh);
  input.mouse.onPick = p.pick;
  input.touch.onTap = (x, y) => {
    p.pick(x, y);
  };
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
  const view: PlayerView = { x: 0, z: 0, yaw: 0, cameraYaw: 0 };
  loop.add({
    update: () => {
      view.x = player.renderPosition.x;
      view.z = player.renderPosition.z;
      view.yaw = player.controller.yaw;
      // The camera sits at (sin yaw, cos yaw) from the player and looks back: it faces yaw + π.
      view.cameraYaw = player.camera.yaw + Math.PI;
      p.frame(view);
    },
    dispose() {},
  });
  // Rendering is the last thing every frame, but the renderer is disposed by the engine, after
  // everything that owns GPU resources has released them.
  loop.add({ update: (dt) => renderer.update(dt), dispose() {} });
  // One step lets Rapier's broad phase see the level before the first camera ray.
  physics.world.step();
  renderer.isAutoRendering = options.isTestMode !== true;
  return {
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
    multiplayer,
    hearts,
    background,
  };
}
