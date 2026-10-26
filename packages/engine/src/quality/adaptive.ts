import type { QualityTier } from '@shipfair/shared';
import {
  ADAPT_DOWN_RATIO,
  ADAPT_UP_RATIO,
  ADAPT_UP_S,
  ADAPT_WINDOW_S,
  MAX_FRAME_S,
  PERF_SAMPLE_S,
  RENDER_SCALES,
  TARGET_FPS,
} from '../config.ts';

/** What the renderer applies. Each visual feature declares the tiers it runs on here. */
export interface QualitySettings {
  renderScale: number;
  shadows: boolean;
  bloom: boolean;
}

/**
 * Levels step down in the order ARCHITECTURE.md §4 gives: render scale 1 → 0.75 → 0.6, then
 * shadows off, then bloom off. `low` has neither shadows nor bloom, so it stops at 0.6.
 */
export function maxLevel(tier: QualityTier): number {
  return tier === 'high' ? RENDER_SCALES.length + 1 : RENDER_SCALES.length - 1;
}

export function settingsFor(
  tier: QualityTier,
  level: number,
  out: QualitySettings,
): QualitySettings {
  const scaleIndex = Math.min(level, RENDER_SCALES.length - 1);
  out.renderScale = RENDER_SCALES[scaleIndex] ?? 1;
  out.shadows = tier === 'high' && level < RENDER_SCALES.length;
  out.bloom = tier === 'high' && level < RENDER_SCALES.length + 1;
  return out;
}

/**
 * The adaptive quality controller. Feed it every frame's length; once per second it completes
 * a sample (`fps` is then fresh). When the 3-second average is under the tier's target it steps
 * quality down; after ADAPT_UP_S seconds comfortably at target it steps back up, but never past
 * the tier the user (or boot detection) chose.
 */
export class AdaptiveQuality {
  readonly settings: QualitySettings = { renderScale: 1, shadows: false, bloom: false };
  /** Frames per second over the last completed sample. */
  fps = 0;
  #tier: QualityTier;
  #level = 0;
  readonly #window = new Float64Array(ADAPT_WINDOW_S);
  #windowCount = 0;
  #windowNext = 0;
  #sampleMs = 0;
  #sampleFrames = 0;
  #goodSeconds = 0;

  constructor(tier: QualityTier) {
    this.#tier = tier;
    settingsFor(tier, 0, this.settings);
  }

  get tier(): QualityTier {
    return this.#tier;
  }

  get level(): number {
    return this.#level;
  }

  /** A new chosen tier resets to its best settings. */
  setTier(tier: QualityTier): void {
    this.#tier = tier;
    this.#setLevel(0);
  }

  /**
   * Records one frame. Returns true when a one-second sample completed; check `settings` then,
   * since the level may have changed. Frames longer than MAX_FRAME_S (a hidden tab, a debugger)
   * say nothing about rendering speed and are ignored.
   */
  frame(frameMs: number): boolean {
    if (!(frameMs > 0) || frameMs > MAX_FRAME_S * 1000) return false;
    this.#sampleMs += frameMs;
    this.#sampleFrames++;
    // The epsilon absorbs float drift from summing frame times like 1000 / 60.
    if (this.#sampleMs < PERF_SAMPLE_S * 1000 - 1e-6) return false;
    this.fps = (this.#sampleFrames * 1000) / this.#sampleMs;
    this.#sampleMs = 0;
    this.#sampleFrames = 0;
    this.#decide(this.fps);
    return true;
  }

  #decide(fps: number): void {
    this.#window[this.#windowNext] = fps;
    this.#windowNext = (this.#windowNext + 1) % this.#window.length;
    this.#windowCount = Math.min(this.#windowCount + 1, this.#window.length);
    const target = TARGET_FPS[this.#tier];

    if (fps >= target * ADAPT_UP_RATIO) this.#goodSeconds++;
    else this.#goodSeconds = 0;
    if (this.#goodSeconds >= ADAPT_UP_S && this.#level > 0) {
      this.#setLevel(this.#level - 1);
      return;
    }

    if (this.#windowCount < this.#window.length) return;
    let sum = 0;
    for (const value of this.#window) sum += value;
    if (
      sum / this.#window.length < target * ADAPT_DOWN_RATIO &&
      this.#level < maxLevel(this.#tier)
    ) {
      this.#setLevel(this.#level + 1);
    }
  }

  #setLevel(level: number): void {
    this.#level = level;
    this.#windowCount = 0;
    this.#windowNext = 0;
    this.#goodSeconds = 0;
    settingsFor(this.#tier, level, this.settings);
  }
}
