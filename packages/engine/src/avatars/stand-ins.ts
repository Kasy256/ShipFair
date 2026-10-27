import { type AvatarStyleV2, HAIR_HEX, PALETTE_HEX, SKIN_HEX } from '@shipfair/shared';
import {
  BufferAttribute,
  CapsuleGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Far players: one InstancedMesh of a simple figure, tinted per instance with the avatar's skin,
// top, bottom and hair colours so people keep their identity at a distance. Prompt 11 adds
// procedural limb posing; this is the static stand-in the 04b LOD policy falls back to.

const PART = { skin: 0, top: 1, bottom: 2, hair: 3 } as const;
const COLORS = ['aSkin', 'aTop', 'aBottom', 'aHair'] as const;

function figure() {
  const piece = (g: CapsuleGeometry | SphereGeometry, part: number, y: number) => {
    g.translate(0, y, 0);
    const geometry = g.index ? g.toNonIndexed() : g;
    if (geometry !== g) g.dispose();
    geometry.deleteAttribute('uv');
    geometry.setAttribute(
      'aPart',
      new BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(part), 1),
    );
    return geometry;
  };
  const parts = [
    piece(new CapsuleGeometry(0.17, 0.7, 2, 8), PART.bottom, 0.55),
    piece(new CapsuleGeometry(0.21, 0.42, 2, 8), PART.top, 1.18),
    piece(new SphereGeometry(0.13, 10, 8), PART.skin, 1.62),
    piece(new SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), PART.hair, 1.65),
  ];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('stand-in geometry failed to merge');
  return merged;
}

const VERTEX_HEAD = `#include <common>
attribute float aPart;
${COLORS.map((c) => `attribute vec3 ${c};`).join('\n')}
varying vec3 vTint;`;
const VERTEX_TINT = `#include <begin_vertex>
vTint = aPart < 0.5 ? aSkin : aPart < 1.5 ? aTop : aPart < 2.5 ? aBottom : aHair;`;

const scratchM = new Matrix4();
const scratchQ = new Quaternion();
const scratchP = new Vector3();
const scratchS = new Vector3(1, 1, 1);
const up = new Vector3(0, 1, 0);
const color = new Color();

function hexFor(style: AvatarStyleV2, part: number): string | undefined {
  if (part === PART.skin) return SKIN_HEX[style.skin];
  if (part === PART.top) return PALETTE_HEX[style.top.color];
  if (part === PART.bottom) return PALETTE_HEX[style.bottom.color];
  return HAIR_HEX[style.hair.color];
}

function tint(
  tints: readonly InstancedBufferAttribute[],
  slot: number,
  style: AvatarStyleV2,
): void {
  for (let k = 0; k < tints.length; k++) {
    color.setStyle(hexFor(style, k) ?? '#888888');
    tints[k]?.setXYZ(slot, color.r, color.g, color.b);
  }
}

export class StandIns {
  readonly mesh: InstancedMesh;
  readonly #tints: InstancedBufferAttribute[];

  constructor(capacity: number) {
    const geometry = figure();
    this.#tints = COLORS.map((name) => {
      const attribute = new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      geometry.setAttribute(name, attribute);
      return attribute;
    });
    const material = new MeshStandardMaterial({ roughness: 0.85 });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', VERTEX_HEAD)
        .replace('#include <begin_vertex>', VERTEX_TINT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec4 diffuseColor = vec4( diffuse * vTint, opacity );',
        );
    };
    material.customProgramCacheKey = () => 'shipfair-stand-in-1';
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'stand-ins';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false; // instances span the whole crowd
    this.mesh.count = 0;
  }

  /**
   * Writes visible stand-in `slot` (slots are packed from 0; set `count` after). Only drawn
   * instances cost triangles, so hidden players are left out rather than scaled to zero.
   */
  set(slot: number, style: AvatarStyleV2, x: number, y: number, z: number, yaw: number): void {
    tint(this.#tints, slot, style);
    this.mesh.setMatrixAt(
      slot,
      scratchM.compose(scratchP.set(x, y, z), scratchQ.setFromAxisAngle(up, yaw), scratchS),
    );
  }

  set count(n: number) {
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const t of this.#tints) t.needsUpdate = true;
  }

  get count(): number {
    return this.mesh.count;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.dispose();
  }
}
