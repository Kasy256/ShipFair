import type { WebGLInfo } from 'three';
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
      return rt()?.layout;
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
  };
}
