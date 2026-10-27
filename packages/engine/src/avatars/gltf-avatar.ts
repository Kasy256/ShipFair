import type { AvatarStyleV2 } from '@shipfair/shared';
import { Group } from 'three';
import type { AvatarView } from '../player/avatar.ts';
import { EMOTE_CLIPS } from './anim-state.ts';
import type { AnimationSet } from './animation-set.ts';
import { Animator } from './animator.ts';
import type { Character } from './character.ts';
import type { CharacterFactory, Lod } from './character-factory.ts';

/**
 * A glTF character behind the same AvatarView interface as the procedural rig (prompt 04).
 * Colour changes update uniforms; item changes rebuild the merged mesh in the background and
 * swap it in when ready, so the avatar never disappears.
 */
export class GltfAvatar implements AvatarView {
  readonly object = new Group();
  readonly nameTagAnchor = new Group();
  readonly #factory: CharacterFactory;
  readonly #animations: AnimationSet;
  readonly #lod: Lod;
  #character: Character;
  #animator: Animator;
  #style: AvatarStyleV2;
  #version = 0;
  readonly #input = { speed: 0, isGrounded: true, vy: 0, isSitting: false };
  #isDisposed = false;
  /** Mixer runs every Nth update (animation LOD: 1 at LOD0, LOD1_ANIMATION_EVERY at LOD1). */
  animEvery = 1;

  private constructor(
    factory: CharacterFactory,
    animations: AnimationSet,
    character: Character,
    style: AvatarStyleV2,
    lod: Lod,
  ) {
    this.#factory = factory;
    this.#animations = animations;
    this.#lod = lod;
    this.#style = style;
    this.#character = character;
    this.#animator = new Animator(character.object, animations, character.bodyId);
    this.object.name = 'avatar';
    this.object.add(character.object);
    character.nameTagAnchor.add(this.nameTagAnchor);
  }

  static async create(
    factory: CharacterFactory,
    animations: AnimationSet,
    style: AvatarStyleV2,
    lod: Lod = 0,
  ): Promise<GltfAvatar> {
    return new GltfAvatar(factory, animations, await factory.create(style, lod), style, lod);
  }

  get character(): Character {
    return this.#character;
  }

  /** The clip with the most weight, e.g. `walk` (for tests and the dev page). */
  get activeClip(): string {
    return this.#animator.activeClip;
  }

  get animator(): Animator {
    return this.#animator;
  }

  setStyle(style: AvatarStyleV2): void {
    this.#style = style;
    if (this.#factory.keyFor(style, this.#lod) === this.#character.key) {
      this.#character.setColors(style);
      return;
    }
    const version = ++this.#version;
    this.#factory.create(style, this.#lod).then(
      (next) => {
        if (this.#isDisposed || version !== this.#version) {
          next.dispose();
          return;
        }
        next.setColors(this.#style);
        this.#swap(next);
      },
      (error: unknown) => console.warn('Avatar rebuild failed; keeping the current look.', error),
    );
  }

  setLocomotion(speed: number, isGrounded: boolean, vy: number): void {
    const input = this.#input;
    input.speed = speed;
    input.isGrounded = isGrounded;
    input.vy = vy;
  }

  /** 1 = solid, 0 = gone (dithered). For LOD cross-fades. */
  setFade(fade: number): void {
    this.#character.setFade(fade);
  }

  setSitting(isSitting: boolean): void {
    this.#input.isSitting = isSitting;
  }

  playEmote(emote: number): void {
    const name = EMOTE_CLIPS[emote];
    if (name) this.#animator.playEmote(name);
  }

  update(dt: number, _time: number): boolean {
    return this.#animator.update(dt, this.#input, this.animEvery);
  }

  dispose(): void {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    this.object.removeFromParent();
    this.#animator.dispose();
    this.#character.dispose();
  }

  #swap(next: Character): void {
    const old = this.#character;
    this.#animator.dispose();
    this.object.remove(old.object);
    old.dispose();
    this.#character = next;
    this.#animator = new Animator(next.object, this.#animations, next.bodyId);
    this.object.add(next.object);
    next.nameTagAnchor.add(this.nameTagAnchor);
  }
}
