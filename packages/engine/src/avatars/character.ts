import type { AvatarStyleV2 } from '@shipfair/shared';
import { type BufferGeometry, Group, type Object3D, type Skeleton, SkinnedMesh } from 'three';
import { writeAvatarColors } from './avatar-colors.ts';
import { createAvatarMaterial, createAvatarUniforms } from './avatar-material.ts';

const NAME_TAG_ABOVE_HEAD_M = 0.3;

/**
 * One assembled avatar: a cloned skeleton and one merged skinned mesh with its own material
 * (and so its own colour and mask uniforms). Geometry is shared with every avatar wearing the
 * same items; `dispose` releases it through `onRelease` and frees the material and bone texture.
 */
export class Character {
  readonly object: Object3D;
  readonly mesh: SkinnedMesh;
  readonly skeleton: Skeleton;
  readonly uniforms = createAvatarUniforms();
  readonly nameTagAnchor = new Group();
  /** Item-set key: equal keys share geometry, and a style change with the same key only recolours. */
  readonly key: string;
  readonly bodyId: string;
  readonly lod: 0 | 1;
  readonly #onRelease: () => void;
  #isDisposed = false;

  constructor(opts: {
    root: Object3D;
    skeleton: Skeleton;
    parent: Object3D;
    geometry: BufferGeometry;
    bindMatrix: SkinnedMesh['bindMatrix'];
    key: string;
    bodyId: string;
    lod: 0 | 1;
    hidden: { body: number; hair: number };
    onRelease: () => void;
  }) {
    this.object = opts.root;
    this.skeleton = opts.skeleton;
    this.key = opts.key;
    this.bodyId = opts.bodyId;
    this.lod = opts.lod;
    this.#onRelease = opts.onRelease;
    const mesh = new SkinnedMesh(opts.geometry, createAvatarMaterial(this.uniforms));
    mesh.name = 'avatar';
    mesh.castShadow = true;
    mesh.bind(opts.skeleton, opts.bindMatrix);
    opts.parent.add(mesh);
    this.mesh = mesh;
    this.uniforms.uHiddenMask.value = opts.hidden.body;
    this.uniforms.uHiddenHairMask.value = opts.hidden.hair;
    const head = opts.skeleton.bones.find((b) => b.name.toLowerCase() === 'head');
    this.nameTagAnchor.position.y = NAME_TAG_ABOVE_HEAD_M;
    (head ?? this.object).add(this.nameTagAnchor);
  }

  /** Colour-only update: no re-merge, just uniforms. */
  setColors(style: AvatarStyleV2): void {
    writeAvatarColors(style, this.uniforms.uColors.value);
  }

  /** 1 = solid, 0 = gone (dithered, so no transparency sorting). */
  setFade(fade: number): void {
    this.uniforms.uFade.value = fade;
  }

  dispose(): void {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    this.object.removeFromParent();
    (this.mesh.material as { dispose(): void }).dispose();
    this.skeleton.dispose();
    this.#onRelease();
  }
}
