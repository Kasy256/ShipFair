import { range, rng } from '@shipfair/shared';
import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  type MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { HEART_BURST_COUNT, HEART_LIFE_S } from '../config.ts';
import type { System } from '../core/loop.ts';
import { createBillboardMaterial } from '../render/billboard-material.ts';
import { context2d, createCanvas } from './textures.ts';

// The upvote heart burst (prompt 12): a few hearts pop out of a booth, rise, drift and fade.
// A fixed pool of billboarded instances of one quad with a canvas-drawn heart: one draw call,
// nothing allocated per frame or per burst. Randomness is seeded, so tests see the same burst.

const POOL = HEART_BURST_COUNT * 3;
const TEXTURE_PX = 64;
const RISE_MPS = 1.4;
const SPREAD_MPS = 0.9;
const GRAVITY_MPS2 = -0.8;
const SIZE_M = 0.32;

const scratch = new Matrix4();
const pos = new Vector3();
const size = new Vector3();
const noRotation = new Quaternion();

function heartTexture(): CanvasTexture {
  const canvas = createCanvas(TEXTURE_PX, TEXTURE_PX);
  const ctx = context2d(canvas);
  const s = TEXTURE_PX;
  ctx.fillStyle = '#ff4f7b';
  ctx.beginPath();
  ctx.moveTo(s / 2, s * 0.86);
  ctx.bezierCurveTo(s * 0.08, s * 0.58, s * 0.06, s * 0.2, s * 0.3, s * 0.16);
  ctx.bezierCurveTo(s * 0.42, s * 0.14, s * 0.48, s * 0.22, s / 2, s * 0.3);
  ctx.bezierCurveTo(s * 0.52, s * 0.22, s * 0.58, s * 0.14, s * 0.7, s * 0.16);
  ctx.bezierCurveTo(s * 0.94, s * 0.2, s * 0.92, s * 0.58, s / 2, s * 0.86);
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export class HeartBurst implements System {
  readonly mesh: InstancedMesh;
  readonly #texture = heartTexture();
  readonly #fades: InstancedBufferAttribute;
  readonly #random = rng(0x4ea7);
  /** Per particle: age (s, ≥ life means free), position and velocity. */
  readonly #age = new Float32Array(POOL).fill(HEART_LIFE_S);
  readonly #p = new Float32Array(POOL * 3);
  readonly #v = new Float32Array(POOL * 3);
  #next = 0;
  #live = 0;

  constructor() {
    const geometry = new PlaneGeometry(1, 1);
    const cells = new InstancedBufferAttribute(new Float32Array(POOL * 2), 2);
    this.#fades = new InstancedBufferAttribute(new Float32Array(POOL), 1);
    this.#fades.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aCell', cells);
    geometry.setAttribute('aFade', this.#fades);
    const material = createBillboardMaterial({
      map: this.#texture,
      name: 'heart-burst',
      columns: 1,
      rows: 1,
      aspect: 1,
      cacheKey: 'shipfair-heart-burst-1',
    });
    this.mesh = new InstancedMesh(geometry, material, POOL);
    this.mesh.name = 'heart-burst';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Hearts in flight (the test API). */
  get live(): number {
    return this.#live;
  }

  /** HEART_BURST_COUNT hearts from (x, y, z). Reuses the oldest slots when the pool is busy. */
  burst(x: number, y: number, z: number): void {
    const random = this.#random;
    for (let k = 0; k < HEART_BURST_COUNT; k++) {
      const i = this.#next;
      this.#next = (this.#next + 1) % POOL;
      this.#age[i] = 0;
      this.#p[i * 3] = x + range(random, -0.3, 0.3);
      this.#p[i * 3 + 1] = y + range(random, -0.1, 0.2);
      this.#p[i * 3 + 2] = z + range(random, -0.3, 0.3);
      this.#v[i * 3] = range(random, -SPREAD_MPS, SPREAD_MPS);
      this.#v[i * 3 + 1] = RISE_MPS * range(random, 0.7, 1.3);
      this.#v[i * 3 + 2] = range(random, -SPREAD_MPS, SPREAD_MPS);
    }
  }

  update(dt: number): void {
    let n = 0;
    for (let i = 0; i < POOL; i++) {
      const age = (this.#age[i] ?? HEART_LIFE_S) + dt;
      if (age >= HEART_LIFE_S + dt) continue; // was already free
      this.#age[i] = age;
      if (age >= HEART_LIFE_S) continue;
      const j = i * 3;
      this.#v[j + 1] = (this.#v[j + 1] ?? 0) + GRAVITY_MPS2 * dt;
      const px = (this.#p[j] ?? 0) + (this.#v[j] ?? 0) * dt;
      const py = (this.#p[j + 1] ?? 0) + (this.#v[j + 1] ?? 0) * dt;
      const pz = (this.#p[j + 2] ?? 0) + (this.#v[j + 2] ?? 0) * dt;
      this.#p[j] = px;
      this.#p[j + 1] = py;
      this.#p[j + 2] = pz;
      const t = age / HEART_LIFE_S;
      // Pop in over the first 15%, fade over the last 40%.
      const scale = SIZE_M * Math.min(1, t / 0.15) * (1 + 0.4 * t);
      this.mesh.setMatrixAt(
        n,
        scratch.compose(pos.set(px, py, pz), noRotation, size.setScalar(scale)),
      );
      this.#fades.setX(n, Math.min(1, (1 - t) / 0.4));
      n++;
    }
    this.#live = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.#fades.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.#texture.dispose();
    this.mesh.dispose();
  }
}
