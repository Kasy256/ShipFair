import type { GeneratedAssetManifest } from '@shipfair/shared';
import { type AnimationClip, Group, VectorKeyframeTrack } from 'three';
import type { AssetManager, LoadedAsset } from '../assets/asset-manager.ts';

const ASSET_ID = 'animations';
const HIPS_TRACK = 'pelvis.position';
const LOCOMOTION = ['idle', 'walk', 'run'] as const;

/**
 * The shared clip set (`humanoid_clips.glb`), loaded once. The clips move every bone by rotation
 * and only the hips by translation, recorded on a body with `pelvisRestHeightM`; per body, the
 * hip track is rescaled to that body's hip height (art/export notes from prompt 04a). Required
 * clips that aren't exported yet resolve to their declared substitutes.
 */
export class AnimationSet {
  readonly #clips: ReadonlyMap<string, AnimationClip>;
  readonly #substitutes: Readonly<Record<string, string>>;
  readonly #restHeight: number | null;
  readonly #hipHeights: ReadonlyMap<string, number>;
  readonly #perBody = new Map<string, Map<string, AnimationClip>>();
  readonly #release: () => void;

  constructor(
    clips: readonly AnimationClip[],
    manifest: Pick<GeneratedAssetManifest, 'animations' | 'characters'> | null,
    release: () => void = () => undefined,
  ) {
    this.#clips = new Map(clips.map((c) => [c.name, c]));
    this.#substitutes = manifest?.animations.substitutes ?? {};
    this.#restHeight = manifest?.animations.pelvisRestHeightM ?? null;
    this.#hipHeights = new Map(manifest?.characters.map((c) => [c.id, c.hipHeightM]) ?? []);
    this.#release = release;
  }

  static async load(
    assets: AssetManager,
    manifest: GeneratedAssetManifest | null,
  ): Promise<AnimationSet> {
    const empty = (): LoadedAsset => ({ scene: new Group(), animations: [], isPlaceholder: true });
    const asset = await assets.load(ASSET_ID, manifest?.animations.url ?? null, empty);
    return new AnimationSet(asset.animations, manifest, () => assets.release(ASSET_ID));
  }

  /** True when idle, walk and run all exist, i.e. characters can be animated at all. */
  get canLocomote(): boolean {
    return LOCOMOTION.every((name) => this.#clips.has(name));
  }

  get names(): string[] {
    return [...this.#clips.keys()];
  }

  /** `name` (or its substitute) for `bodyId`, with the hip track scaled to that body. */
  clip(name: string, bodyId: string): AnimationClip | undefined {
    const resolved = this.#clips.has(name) ? name : this.#substitutes[name];
    if (resolved === undefined) return undefined;
    let cache = this.#perBody.get(bodyId);
    if (!cache) {
      cache = new Map();
      this.#perBody.set(bodyId, cache);
    }
    const cached = cache.get(resolved);
    if (cached) return cached;
    const source = this.#clips.get(resolved);
    if (!source) return undefined;
    const scaled = this.#scaleHips(source, bodyId);
    cache.set(resolved, scaled);
    return scaled;
  }

  dispose(): void {
    this.#perBody.clear();
    this.#release();
  }

  #scaleHips(source: AnimationClip, bodyId: string): AnimationClip {
    const hip = this.#hipHeights.get(bodyId);
    const rest = this.#restHeight;
    if (hip === undefined || rest === null || rest <= 0 || Math.abs(hip / rest - 1) < 1e-3)
      return source;
    const clip = source.clone();
    const ratio = hip / rest;
    clip.tracks = clip.tracks.map((track) => {
      if (track.name !== HIPS_TRACK) return track;
      const values = Float32Array.from(track.values, (v) => v * ratio);
      return new VectorKeyframeTrack(track.name, Array.from(track.times), Array.from(values));
    });
    return clip;
  }
}
