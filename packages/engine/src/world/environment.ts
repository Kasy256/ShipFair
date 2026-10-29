import type { QualityTier } from '@shipfair/shared';
import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  PMREMGenerator,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  FOG_RANGE_M,
  SHADOW_EXTENT_M,
  SHADOW_MAP_PX,
  SKY_RADIUS_M,
  THEME_TINT_HZ,
} from '../config.ts';
import { DEFAULT_THEME, type DistrictTheme } from './themes.ts';

/** Fog matches the sky's horizon colour so far things fade into it. */
const HORIZON = 0xd9c7b4;
const SUN_OFFSET = { x: 30, y: 60, z: 22 } as const;
const SUN_ELEVATION_DEG = 58;
const SUN_AZIMUTH_DEG = 200;

// Gradient sky from the prototype: zenith → mid → horizon, a soft sun glow, and the far plane
// (z = w) so it never clips. Its horizon is a warm pastel, not the blown-out white of a
// physical sky at this exposure.
const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}`;
const SKY_FRAGMENT = /* glsl */ `
varying vec3 vDir;
uniform vec3 sunDir;
void main() {
  float h = vDir.y;
  vec3 zenith = vec3(0.10, 0.22, 0.52);
  vec3 mid = vec3(0.38, 0.58, 0.86);
  vec3 horizon = vec3(0.85, 0.78, 0.70);
  vec3 ground = vec3(0.36, 0.33, 0.32);
  vec3 c = h > 0.0
    ? mix(mix(horizon, mid, smoothstep(0.0, 0.18, h)), zenith, smoothstep(0.18, 0.75, h))
    : mix(horizon, ground, smoothstep(0.0, 0.08, -h));
  float sd = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
  c += vec3(1.0, 0.75, 0.45) * (pow(sd, 18.0) * 0.35 + pow(sd, 900.0) * 2.0);
  gl_FragColor = vec4(c * 0.92, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Sky dome, fog, hemisphere light, a PMREM room environment for reflections and a sun whose
 * shadow follows the player (prototype main.js/venue.js). Shadows run only when the quality
 * settings say so (`high`, until the adaptive controller turns them off). The hemisphere light
 * eases toward the current district's tint.
 */
export class Environment {
  readonly sun = new DirectionalLight(0xfff1dd, 1.7);
  readonly hemi = new HemisphereLight(
    DEFAULT_THEME.ambient.sky,
    DEFAULT_THEME.ambient.ground,
    0.85,
  );
  readonly sky: Mesh<SphereGeometry, ShaderMaterial>;
  readonly #envTarget: WebGLRenderTarget;
  readonly #scene: Scene;
  readonly #fog = new Fog(HORIZON, FOG_RANGE_M.high[0], FOG_RANGE_M.high[1]);
  readonly #targetSky = new Color(DEFAULT_THEME.ambient.sky);
  readonly #targetGround = new Color(DEFAULT_THEME.ambient.ground);

  constructor(renderer: WebGLRenderer, scene: Scene, tier: QualityTier = 'high') {
    this.#scene = scene;
    scene.background = new Color(HORIZON);
    scene.fog = this.#fog;
    this.setTier(tier);

    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.#envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    scene.environment = this.#envTarget.texture as Texture;
    scene.environmentIntensity = 0.55;

    const sunDir = new Vector3().setFromSphericalCoords(
      1,
      ((90 - SUN_ELEVATION_DEG) * Math.PI) / 180,
      (SUN_AZIMUTH_DEG * Math.PI) / 180,
    );
    const skyMaterial = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { sunDir: { value: sunDir } },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
    });
    this.sky = new Mesh(new SphereGeometry(SKY_RADIUS_M, 32, 16), skyMaterial);
    this.sky.name = 'sky';
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;

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
    scene.add(this.hemi, sun, sun.target, this.sky);
  }

  /** Fog closes in on `low`, hiding the draw-distance edge. */
  setTier(tier: QualityTier): void {
    const [near, far] = FOG_RANGE_M[tier];
    this.#fog.near = near;
    this.#fog.far = far;
  }

  /** Eases the ambient light toward `theme` (the default theme on the plaza). */
  setTheme(theme: DistrictTheme): void {
    this.#targetSky.setHex(theme.ambient.sky);
    this.#targetGround.setHex(theme.ambient.ground);
  }

  /** Keeps the shadow frustum and sky centred on the player, and eases the tint. */
  follow(focus: Vector3, dt = 0): void {
    this.sun.position.set(focus.x + SUN_OFFSET.x, SUN_OFFSET.y, focus.z + SUN_OFFSET.z);
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.target.updateMatrixWorld();
    this.sky.position.set(focus.x, 0, focus.z);
    const k = 1 - Math.exp(-dt * THEME_TINT_HZ);
    this.hemi.color.lerp(this.#targetSky, k);
    this.hemi.groundColor.lerp(this.#targetGround, k);
  }

  dispose(): void {
    const scene = this.#scene;
    scene.remove(this.hemi, this.sun, this.sun.target, this.sky);
    scene.environment = null;
    scene.background = null;
    scene.fog = null;
    this.sun.dispose();
    this.hemi.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.#envTarget.dispose();
  }
}
