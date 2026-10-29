import type { WebGLInfo } from 'three';
import { GltfAvatar } from './avatars/gltf-avatar.ts';
import { type CityTestApi, createCityTestApi } from './debug/city-test-api.ts';
import type { Engine } from './engine.ts';
import type { InputAction, ScriptedMove } from './input/manager.ts';
import type { TestLevelLayout } from './world/test-level-layout.ts';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * `window.__shipfair`, for Playwright (the prototype's `window.__expo`). The web shell installs
 * it in non-production builds only. Values are plain numbers so `page.evaluate` can return them.
 */
export interface ShipfairTestApi {
  engine: Engine;
  step(dt: number, n?: number): void;
  renderOnce(): { calls: number; triangles: number };
  readonly info: WebGLInfo | undefined;
  readonly level: TestLevelLayout | undefined;
  player: {
    readonly position: Vec3Like;
    readonly velocity: Vec3Like;
    readonly isGrounded: boolean;
    readonly yaw: number;
    readonly jumps: number;
    readonly footsteps: number;
    /** The dominant clip of the glTF avatar (null while it is the procedural rig). */
    readonly activeClip: string | null;
    readonly input: ScriptedMove | undefined;
    press(action: InputAction): void;
    teleport(x: number, y: number, z: number, yaw?: number): void;
  };
  camera: {
    readonly position: Vec3Like;
    readonly fallbacks: number;
    set(yaw: number, pitch: number, distance: number): void;
  };
  physics: {
    isInside(x: number, y: number, z: number): boolean;
  };
  assets: {
    /** Waits for art to load and the local avatar swap, then reports what was used. */
    ready(): Promise<AssetsStatus>;
  };
  /** Fake remote players under the LOD policy (prompt 04b). */
  crowd: {
    spawn(count: number, seed: number, x: number, z: number): void;
    /** Target LODs from the last evaluation: [LOD0, LOD1, stand-in]. */
    counts(): [number, number, number];
    /** What is on screen now (glTF avatars that finished building). */
    shown(): [number, number, number];
    /** Resolves when every avatar build started so far is done. */
    settled(): Promise<void>;
  };
  /** The city built from the snapshot (prompt 05). */
  city: CityTestApi;
  /** A booth city for draw-call and triangle budgets. */
  stress: {
    city(booths: number, seed?: number): { booths: number; props: number };
    clear(): void;
  };
}

export interface AssetsStatus {
  hasManifest: boolean;
  /** True when the local player is a glTF character (false: the procedural fallback). */
  isAvatarGltf: boolean;
  missing: string[];
  /** Built entries that are generated placeholders (their export is missing). */
  placeholders: string[];
  clips: string[];
}

const vec = (v: Vec3Like | undefined): Vec3Like => ({ x: v?.x ?? 0, y: v?.y ?? 0, z: v?.z ?? 0 });

export function createTestApi(engine: Engine): ShipfairTestApi {
  const rt = () => engine.runtime;
  return {
    engine,
    step: (dt, n) => engine.step(dt, n),
    renderOnce: () => engine.renderOnce(),
    get info() {
      return rt()?.renderer.info;
    },
    get level() {
      return rt()?.layout ?? undefined;
    },
    player: {
      get position() {
        return vec(rt()?.player.controller.position);
      },
      get velocity() {
        return vec(rt()?.player.controller.velocity);
      },
      get isGrounded() {
        return rt()?.player.controller.isGrounded ?? false;
      },
      get yaw() {
        return rt()?.player.controller.yaw ?? 0;
      },
      get jumps() {
        return rt()?.player.controller.jumps ?? 0;
      },
      get footsteps() {
        return rt()?.player.footsteps ?? 0;
      },
      get activeClip() {
        const avatar = rt()?.player.avatar;
        return avatar instanceof GltfAvatar ? avatar.activeClip : null;
      },
      get input() {
        return rt()?.input.script;
      },
      press: (action) => rt()?.input.press(action),
      teleport: (x, y, z, yaw) => rt()?.player.teleport(x, y, z, yaw),
    },
    camera: {
      get position() {
        return vec(rt()?.player.camera.camera.position);
      },
      get fallbacks() {
        return rt()?.player.camera.fallbacks ?? 0;
      },
      set(yaw, pitch, distance) {
        const camera = rt()?.player.camera;
        if (!camera) return;
        camera.yaw = yaw;
        camera.pitch = pitch;
        camera.distance = distance;
      },
    },
    physics: {
      isInside: (x, y, z) => rt()?.physics.isInsideStatic({ x, y, z }) ?? false,
    },
    assets: {
      async ready() {
        const art = await rt()?.art.ready;
        const m = art?.manifest ?? null;
        const placeholders = m
          ? [
              ...m.characters.filter((c) => c.isPlaceholder).map((c) => c.id),
              ...(m.animations.isPlaceholder ? ['animations'] : []),
              ...(m.boothKit.isPlaceholder ? ['booth-kit'] : []),
              ...m.props.filter((p) => p.isPlaceholder).map((p) => p.id),
            ]
          : [];
        return {
          hasManifest: m !== null,
          isAvatarGltf: rt()?.player.avatar instanceof GltfAvatar,
          missing: [...(art?.assets.missing ?? [])],
          placeholders,
          clips: art?.animations.names ?? [],
        };
      },
    },
    crowd: {
      spawn(count, seed, x, z) {
        const runtime = rt();
        runtime?.art.stress?.spawnCrowd(count, seed, x, z);
      },
      counts: () =>
        [...(rt()?.art.stress?.crowd?.counts() ?? [0, 0, 0])] as [number, number, number],
      shown: () => rt()?.art.stress?.crowd?.shownCounts() ?? [0, 0, 0],
      settled: async () => rt()?.art.stress?.crowd?.settled(),
    },
    city: createCityTestApi(engine),
    stress: {
      city: (booths, seed) => rt()?.art.stress?.buildCity(booths, seed) ?? { booths: 0, props: 0 },
      clear: () => rt()?.art.stress?.clearCity(),
    },
  };
}
