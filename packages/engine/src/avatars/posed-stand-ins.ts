import type { QualityTier } from '@shipfair/shared';
import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAND_IN_CHUNK } from '../config.ts';
import type { Pose } from './pose.ts';

// Far remote players (ARCHITECTURE.md §4): the prototype's instanced crowd figure, one
// InstancedMesh per body part (torso, head, hair, arms, thighs, shins), so a whole crowd is six
// draw calls. Limbs are posed every frame from the shared pose function; each instance is tinted
// with the avatar's skin, top, bottom and hair colours and can dither in and out (join, leave,
// LOD swaps). Capacity grows in chunks of STAND_IN_CHUNK players.

/** Linear RGB per player: skin, top, bottom, hair (12 floats). */
export const TINT_FLOATS = 12;
const SKIN = 0;
const TOP = 3;
const BOTTOM = 6;
const HAIR = 9;

const PART = ['torso', 'head', 'hair', 'arm', 'thigh', 'shin'] as const;
type Part = (typeof PART)[number];
/** Instances per player, and which tint each part takes. */
const PER_PLAYER: Record<Part, number> = { torso: 1, head: 1, hair: 1, arm: 2, thigh: 2, shin: 2 };
const TINT_OF: Record<Part, number> = {
  torso: TOP,
  head: SKIN,
  hair: HAIR,
  arm: TOP,
  thigh: BOTTOM,
  shin: BOTTOM,
};

/** White vertex colours, with `shade` on the second geometry (the shoe under a shin). */
function shaded(a: BufferGeometry, b?: BufferGeometry, shade = 1): BufferGeometry {
  const parts = b ? [a.toNonIndexed(), b.toNonIndexed()] : [a.toNonIndexed()];
  parts.forEach((g, i) => {
    const n = g.getAttribute('position').count;
    g.deleteAttribute('uv');
    g.setAttribute(
      'color',
      new Float32BufferAttribute(new Float32Array(n * 3).fill(i === 0 ? 1 : shade), 3),
    );
  });
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  a.dispose();
  b?.dispose();
  if (!merged) throw new Error('stand-in geometry failed to merge');
  if (merged !== parts[0]) for (const p of parts) p.dispose();
  return merged;
}

function limb(r: number, len: number, drop: number, segments: number, isShin: boolean) {
  const g = new CapsuleGeometry(r, len, 1, segments).translate(0, -drop, 0);
  if (!isShin) return shaded(g);
  return shaded(g, new BoxGeometry(0.11, 0.07, 0.24).translate(0, -0.45, 0.05), 0.22);
}

/** Geometry per part; the low tier uses fewer segments (prototype GEO_LO / GEO). */
function geometries(tier: QualityTier): Record<Part, BufferGeometry> {
  const hi = tier === 'high';
  return {
    torso: shaded(new CapsuleGeometry(0.17, 0.3, hi ? 3 : 2, hi ? 8 : 6).scale(1.22, 1, 0.72)),
    head: shaded(new SphereGeometry(0.115, hi ? 10 : 7, hi ? 7 : 5).scale(1, 1.12, 1.02)),
    hair: shaded(
      new SphereGeometry(
        0.125,
        hi ? 10 : 7,
        hi ? 4 : 3,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.55,
      ).translate(0, 0.025, -0.012),
    ),
    arm: limb(0.048, 0.5, 0.3, hi ? 6 : 5, false),
    thigh: limb(0.072, 0.32, 0.225, hi ? 6 : 5, false),
    shin: limb(0.06, 0.34, 0.225, hi ? 6 : 5, true),
  };
}

const FADE_HEAD = /* glsl */ `#include <common>
attribute float aFade;
varying float vFade;`;
const FADE_FRAGMENT_HEAD = /* glsl */ `#include <common>
varying float vFade;`;
// The same screen-door dither as the glTF avatars, so cross-fades between the two match.
const FADE_DISCARD = /* glsl */ `#include <clipping_planes_fragment>
if (vFade < 1.0) {
  float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  if (noise > vFade) discard;
}`;

function createMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  material.name = 'stand-in';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', FADE_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FADE_FRAGMENT_HEAD)
      .replace('#include <clipping_planes_fragment>', FADE_DISCARD);
  };
  material.customProgramCacheKey = () => 'shipfair-posed-stand-in-1';
  return material;
}

const root = new Matrix4();
const local = new Matrix4();
const rot = new Matrix4();
const out = new Matrix4();
const thigh = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const v = new Vector3();
const one = new Vector3(1, 1, 1);
const UP = new Vector3(0, 1, 0);
/** The prototype figure's hip height; the pose's hipsY is relative to the procedural rig. */
const HIP_OFFSET_M = -0.05;

interface PartMesh {
  readonly mesh: InstancedMesh;
  readonly fade: InstancedBufferAttribute;
  readonly per: number;
  readonly tint: number;
}

export class PosedStandIns {
  readonly root = new Group();
  #geometry: Record<Part, BufferGeometry>;
  readonly #material = createMaterial();
  #parts: Record<Part, PartMesh>;
  #capacity = 0;
  #count = 0;

  constructor(tier: QualityTier) {
    this.root.name = 'stand-ins';
    this.#geometry = geometries(tier);
    this.#parts = this.#build(STAND_IN_CHUNK);
  }

  /** Players that fit before the next growth. */
  get capacity(): number {
    return this.#capacity;
  }

  /** Players drawn this frame. */
  get count(): number {
    return this.#count;
  }

  /** Makes room for `players`, growing in chunks of STAND_IN_CHUNK (rebuilds the meshes). */
  ensure(players: number): void {
    if (players <= this.#capacity) return;
    const next = Math.ceil(players / STAND_IN_CHUNK) * STAND_IN_CHUNK;
    this.#disposeMeshes();
    this.#parts = this.#build(next);
  }

  /** Switches between the low and high detail figure. */
  setTier(tier: QualityTier): void {
    this.#disposeMeshes();
    for (const g of Object.values(this.#geometry)) g.dispose();
    this.#geometry = geometries(tier);
    this.#parts = this.#build(this.#capacity);
  }

  begin(): void {
    this.#count = 0;
  }

  /**
   * Draws one player this frame (call between `begin` and `end`). `tints` is TINT_FLOATS linear
   * RGB values; `fade` 1 is solid. Players beyond capacity are skipped (call `ensure` first).
   */
  add(
    tints: Float32Array,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pose: Pose,
    fade: number,
  ): void {
    const i = this.#count;
    if (i >= this.#capacity || fade <= 0) return;
    this.#count++;
    const p = this.#parts;
    root.compose(v.set(x, y, z), q.setFromAxisAngle(UP, yaw), one);
    const hipY = pose.hipsY + HIP_OFFSET_M;
    const lean = pose.chestLean;
    local.makeTranslation(0, hipY + 0.3, 0);
    out.multiplyMatrices(root, local).multiply(rot.makeRotationX(lean));
    this.#put(p.torso, i, 0, out, tints, fade);
    local.makeTranslation(0, hipY + 0.71, lean * 0.45);
    out.multiplyMatrices(root, local);
    this.#put(p.head, i, 0, out, tints, fade);
    this.#put(p.hair, i, 0, out, tints, fade);
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      local.makeTranslation(side * 0.215, hipY + 0.5, lean * 0.3);
      e.set(
        s === 0 ? pose.shoulderX0 : pose.shoulderX1,
        0,
        s === 0 ? pose.shoulderZ0 : pose.shoulderZ1,
      );
      out.multiplyMatrices(root, local).multiply(rot.makeRotationFromEuler(e));
      this.#put(p.arm, i, s, out, tints, fade);
      local.makeTranslation(side * 0.095, hipY, 0);
      thigh
        .multiplyMatrices(root, local)
        .multiply(rot.makeRotationX(s === 0 ? pose.hip0 : pose.hip1));
      this.#put(p.thigh, i, s, thigh, tints, fade);
      local.makeTranslation(0, -0.45, 0);
      out
        .multiplyMatrices(thigh, local)
        .multiply(rot.makeRotationX(s === 0 ? pose.knee0 : pose.knee1));
      this.#put(p.shin, i, s, out, tints, fade);
    }
  }

  end(): void {
    for (const name of PART) {
      const part = this.#parts[name];
      part.mesh.count = this.#count * part.per;
      part.mesh.visible = this.#count > 0;
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
      part.fade.needsUpdate = true;
    }
  }

  dispose(): void {
    this.#disposeMeshes();
    for (const g of Object.values(this.#geometry)) g.dispose();
    this.#material.dispose();
    this.root.removeFromParent();
  }

  #put(
    part: PartMesh,
    player: number,
    side: number,
    matrix: Matrix4,
    tints: Float32Array,
    fade: number,
  ) {
    const slot = player * part.per + side;
    part.mesh.setMatrixAt(slot, matrix);
    const colors = part.mesh.instanceColor?.array;
    if (colors) {
      colors[slot * 3] = tints[part.tint] ?? 1;
      colors[slot * 3 + 1] = tints[part.tint + 1] ?? 1;
      colors[slot * 3 + 2] = tints[part.tint + 2] ?? 1;
    }
    part.fade.setX(slot, fade);
  }

  #build(capacity: number): Record<Part, PartMesh> {
    this.#capacity = capacity;
    const parts = {} as Record<Part, PartMesh>;
    for (const name of PART) {
      const per = PER_PLAYER[name];
      // A copy per mesh, so the fade attribute (sized to capacity) is freed with it on growth.
      const geometry = this.#geometry[name].clone();
      const fade = new InstancedBufferAttribute(new Float32Array(capacity * per).fill(1), 1);
      fade.setUsage(DynamicDrawUsage);
      geometry.setAttribute('aFade', fade);
      const mesh = new InstancedMesh(geometry, this.#material, capacity * per);
      mesh.name = `stand-in-${name}`;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.instanceColor = new InstancedBufferAttribute(
        new Float32Array(capacity * per * 3).fill(1),
        3,
      );
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances span the whole crowd
      this.root.add(mesh);
      parts[name] = { mesh, fade, per, tint: TINT_OF[name] };
    }
    return parts;
  }

  #disposeMeshes(): void {
    for (const name of PART) {
      const part = this.#parts[name];
      part.mesh.removeFromParent();
      part.mesh.geometry.dispose();
      part.mesh.dispose();
    }
  }
}
