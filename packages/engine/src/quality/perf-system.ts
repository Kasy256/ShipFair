import type { EngineEvents, EventBus, QualityTier } from '@shipfair/shared';
import { BENCHMARK_FRAMES } from '../config.ts';
import type { Loop, System } from '../core/loop.ts';
import type { Renderer } from '../render/renderer.ts';
import { AdaptiveQuality } from './adaptive.ts';
import { tierAfterBenchmark } from './detect.ts';

/** Frames skipped before the benchmark starts timing (shader compiles, first uploads). */
const BENCHMARK_WARMUP_FRAMES = 5;
const MB = 1024 * 1024;

/**
 * Runs the boot benchmark, then the adaptive controller, and emits `perf:sample` once a second.
 * It reads real frame times, so it does nothing in test mode (no rAF, `frameMs` stays 0).
 */
export class PerfSystem implements System {
  readonly adaptive: AdaptiveQuality;
  readonly #loop: Loop;
  readonly #renderer: Renderer;
  readonly #bus: EventBus;
  readonly #onBenchmarkTier: ((tier: QualityTier) => void) | undefined;
  readonly #sample: EngineEvents['perf:sample'] = {
    fps: 0,
    drawCalls: 0,
    triangles: 0,
    textureMb: 0,
    renderScale: 1,
  };
  #benchFrames = 0;
  #benchMs = 0;
  #level = 0;
  /** Estimated texture bytes (the booth texture cache); renderer.info can't report them. */
  textureBytes: () => number = () => 0;
  /** Average frame time measured by the boot benchmark, once it has finished. */
  benchmarkMs: number | undefined;

  /** `onBenchmarkTier` is called if the benchmark wants a lower tier; omit it to skip that. */
  constructor(
    loop: Loop,
    renderer: Renderer,
    bus: EventBus,
    tier: QualityTier,
    onBenchmarkTier?: (tier: QualityTier) => void,
  ) {
    this.#loop = loop;
    this.#renderer = renderer;
    this.#bus = bus;
    this.#onBenchmarkTier = onBenchmarkTier;
    this.adaptive = new AdaptiveQuality(tier);
    renderer.apply(tier, this.adaptive.settings);
  }

  setTier(tier: QualityTier): void {
    this.adaptive.setTier(tier);
    this.#level = this.adaptive.level;
    this.#renderer.apply(tier, this.adaptive.settings);
  }

  update(): void {
    const frameMs = this.#loop.frameMs;
    if (frameMs <= 0) return;
    if (this.benchmarkMs === undefined) this.#benchmark(frameMs);
    if (!this.adaptive.frame(frameMs)) return;

    if (this.adaptive.level !== this.#level) {
      this.#level = this.adaptive.level;
      this.#renderer.apply(this.adaptive.tier, this.adaptive.settings);
    }
    const info = this.#renderer.info;
    const sample = this.#sample;
    sample.fps = Math.round(this.adaptive.fps * 10) / 10;
    sample.drawCalls = info.render.calls;
    sample.triangles = info.render.triangles;
    sample.textureMb = Math.round((this.textureBytes() / MB) * 10) / 10;
    sample.renderScale = this.adaptive.settings.renderScale;
    this.#bus.emit('perf:sample', sample);
  }

  dispose(): void {}

  #benchmark(frameMs: number): void {
    this.#benchFrames++;
    if (this.#benchFrames <= BENCHMARK_WARMUP_FRAMES) return;
    this.#benchMs += frameMs;
    if (this.#benchFrames < BENCHMARK_WARMUP_FRAMES + BENCHMARK_FRAMES) return;
    this.benchmarkMs = this.#benchMs / BENCHMARK_FRAMES;
    const tier = tierAfterBenchmark(this.adaptive.tier, this.benchmarkMs);
    if (tier !== this.adaptive.tier) this.#onBenchmarkTier?.(tier);
  }
}
