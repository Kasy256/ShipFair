import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PMREMGenerator,
  type Scene,
  type Texture,
  type Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SHADOW_EXTENT_M, SHADOW_MAP_PX } from '../config.ts';

const SKY = 0xbfd4e6;
const SUN_OFFSET = { x: 30, y: 60, z: 22 } as const;

/**
 * Sky colour, fog, hemisphere light, a PMREM room environment for reflections and a sun whose
 * shadow follows the player (prototype main.js). Shadows run only when the quality settings say
 * so (`high`, until the adaptive controller turns them off).
 */
export class Environment {
  readonly sun = new DirectionalLight(0xfff1dd, 1.7);
  readonly hemi = new HemisphereLight(0xdfe6ff, 0x3a3540, 0.85);
  readonly #envTarget: WebGLRenderTarget;
  readonly #scene: Scene;
  readonly #background = new Color(SKY);

  constructor(renderer: WebGLRenderer, scene: Scene) {
    this.#scene = scene;
    scene.background = this.#background;
    scene.fog = new Fog(SKY, 60, 220);

    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.#envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    scene.environment = this.#envTarget.texture as Texture;
    scene.environmentIntensity = 0.55;

    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);
    const cam = sun.shadow.camera;
    cam.left = -SHADOW_EXTENT_M;
    cam.bottom = -SHADOW_EXTENT_M;
    cam.right = SHADOW_EXTENT_M;
    cam.top = SHADOW_EXTENT_M;
    cam.near = 1;
    cam.far = 140;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(this.hemi, sun, sun.target);
  }

  /** Keeps the shadow frustum centred on the player. */
  follow(focus: Vector3): void {
    this.sun.position.set(focus.x + SUN_OFFSET.x, SUN_OFFSET.y, focus.z + SUN_OFFSET.z);
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    const scene = this.#scene;
    scene.remove(this.hemi, this.sun, this.sun.target);
    scene.environment = null;
    scene.background = null;
    scene.fog = null;
    this.sun.dispose();
    this.hemi.dispose();
    this.#envTarget.dispose();
  }
}
