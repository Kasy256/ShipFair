import type { QualityTier } from '@shipfair/shared';
import {
  ACESFilmicToneMapping,
  type Material,
  type Mesh,
  PCFSoftShadowMap,
  type PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  type WebGLInfo,
  WebGLRenderer,
} from 'three';
import { PIXEL_RATIO_CAP, TONE_MAPPING_EXPOSURE } from '../config.ts';
import type { System } from '../core/loop.ts';
import type { QualitySettings } from '../quality/adaptive.ts';
import { BloomPipeline } from './post.ts';

/**
 * WebGL renderer: sRGB output, ACES tone mapping, pixel ratio capped by tier and scaled by the
 * adaptive controller, sized by a ResizeObserver on the canvas. Renders as the last system of
 * every frame unless `isAutoRendering` is off (test mode renders on demand).
 */
export class Renderer implements System {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly #camera: PerspectiveCamera;
  readonly #canvas: HTMLCanvasElement;
  readonly #observer: ResizeObserver | undefined;
  #bloom: BloomPipeline | undefined;
  #tier: QualityTier;
  #renderScale = 1;
  #width = 1;
  #height = 1;
  isAutoRendering = true;

  constructor(canvas: HTMLCanvasElement, camera: PerspectiveCamera, tier: QualityTier) {
    this.#canvas = canvas;
    this.#camera = camera;
    this.#tier = tier;
    const renderer = new WebGLRenderer({
      canvas,
      antialias: tier === 'high',
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    renderer.shadowMap.type = PCFSoftShadowMap;
    // Bloom renders several passes a frame; counters are reset once per frame so they add up.
    renderer.info.autoReset = false;
    this.renderer = renderer;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.resize());
      this.#observer.observe(canvas);
    }
  }

  /** Draw calls, triangles and GPU memory counters (geometries, textures). */
  get info(): WebGLInfo {
    return this.renderer.info;
  }

  get renderScale(): number {
    return this.#renderScale;
  }

  get pixelRatio(): number {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    return Math.min(dpr, PIXEL_RATIO_CAP[this.#tier]) * this.#renderScale;
  }

  /** Applies a tier and the adaptive controller's settings. */
  apply(tier: QualityTier, settings: QualitySettings): void {
    this.#tier = tier;
    this.#renderScale = settings.renderScale;
    if (this.renderer.shadowMap.enabled !== settings.shadows) {
      this.renderer.shadowMap.enabled = settings.shadows;
      // Materials compile shadow support in or out, so they must recompile.
      this.scene.traverse((object) => {
        const material = (object as Mesh).material as Material | Material[] | undefined;
        if (Array.isArray(material)) for (const m of material) m.needsUpdate = true;
        else if (material) material.needsUpdate = true;
      });
    }
    if (settings.bloom && !this.#bloom) {
      this.#bloom = new BloomPipeline(this.renderer, this.scene, this.#camera);
    } else if (!settings.bloom && this.#bloom) {
      this.#bloom.dispose();
      this.#bloom = undefined;
    }
    this.resize();
  }

  resize(): void {
    const width = Math.max(1, this.#canvas.clientWidth || this.#canvas.width);
    const height = Math.max(1, this.#canvas.clientHeight || this.#canvas.height);
    const pixelRatio = this.pixelRatio;
    const isSame =
      width === this.#width &&
      height === this.#height &&
      pixelRatio === this.renderer.getPixelRatio();
    this.#width = width;
    this.#height = height;
    if (!isSame) {
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height, false);
    }
    this.#bloom?.setSize(width, height, pixelRatio);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  render(dt = 0): void {
    this.renderer.info.reset();
    if (this.#bloom) this.#bloom.render(dt);
    else this.renderer.render(this.scene, this.#camera);
  }

  update(dt: number): void {
    if (this.isAutoRendering) this.render(dt);
  }

  dispose(): void {
    this.#observer?.disconnect();
    this.#bloom?.dispose();
    this.#bloom = undefined;
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }
}
