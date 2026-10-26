import { type Camera, type Scene, Vector2, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD } from '../config.ts';

/** Bloom post-processing (prototype main.js). Tiers: `high` only. */
export class BloomPipeline {
  readonly #composer: EffectComposer;
  readonly #render: RenderPass;
  readonly #bloom: UnrealBloomPass;
  readonly #output: OutputPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const size = renderer.getSize(new Vector2());
    this.#composer = new EffectComposer(renderer);
    this.#render = new RenderPass(scene, camera);
    this.#bloom = new UnrealBloomPass(
      new Vector2(size.x / 2, size.y / 2),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    this.#output = new OutputPass();
    this.#composer.addPass(this.#render);
    this.#composer.addPass(this.#bloom);
    this.#composer.addPass(this.#output);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.#composer.setPixelRatio(pixelRatio);
    this.#composer.setSize(width, height);
  }

  render(dt: number): void {
    this.#composer.render(dt);
  }

  dispose(): void {
    this.#render.dispose();
    this.#bloom.dispose();
    this.#output.dispose();
    this.#composer.dispose();
  }
}
