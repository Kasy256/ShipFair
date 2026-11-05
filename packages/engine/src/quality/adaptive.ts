import { type QualityTier, TEXTURE_STREAM_RADIUS_M } from '@shipfair/shared';
import {
  ADAPT_DOWN_RATIO,
  ADAPT_UP_RATIO,
  ADAPT_UP_S,
  ADAPT_WINDOW_S,
  MAX_FRAME_S,
  NAME_TAG_MAX_DISTANCE_M,
  NAME_TAG_REDUCED_DISTANCE_M,
  PERF_SAMPLE_S,
  RENDER_SCALES,
  TARGET_FPS,
  TEXTURE_STREAM_REDUCED_RADIUS_M,
} from '../config.ts';

/** What the renderer and the world apply. Each visual feature declares its tiers here. */
export interface QualitySettings {
  renderScale: number;
  shadows: boolean;
  bloom: boolean;
  /** Remote players' name tags (and chat bubbles) show within this distance. */
  nameTagDistanceM: number;
  /** Booth logos and screenshots stream within this radius. */
  streamRadiusM: number;
}

type Step = 'shadows' | 'bloom' | 'nameTags' | 'stream';
/** What gets switched off after render scale bottoms out, in order. `low` has no shadows or bloom. */
const STEPS: Record<QualityTier, readonly Step[]> = {
  high: ['shadows', 'bloom', 'nameTags', 'stream'],
  low: ['nameTags', 'stream'],
};

/**
 * Levels step down in the order ARCHITECTURE.md §4 gives: render scale 1 → 0.75 → 0.6, then
 * shadows off, bloom off, name tags to 15 m, booth images to a 20 m radius.
 */
export function maxLevel(tier: QualityTier): number {
  return RENDER_SCALES.length - 1 + STEPS[tier].length;
}

export function settingsFor(
  tier: QualityTier,
  level: number,
  out: QualitySettings,
): QualitySettings {
  const scaleIndex = Math.min(level, RENDER_SCALES.length - 1);
  const steps = STEPS[tier];
  const offCount = Math.max(0, level - (RENDER_SCALES.length - 1));
  // A step the tier doesn't list is never on (shadows and bloom on `low`).
  const isOn = (step: Step) => steps.indexOf(step) >= offCount;
  out.renderScale = RENDER_SCALES[scaleIndex] ?? 1;
  out.shadows = isOn('shadows');
  out.bloom = isOn('bloom');
  out.nameTagDistanceM = isOn('nameTags') ? NAME_TAG_MAX_DISTANCE_M : NAME_TAG_REDUCED_DISTANCE_M;
  out.streamRadiusM = isOn('stream') ? TEXTURE_STREAM_RADIUS_M : TEXTURE_STREAM_REDUCED_RADIUS_M;
  return out;
}

/**
 * The adaptive quality controller. Feed it every frame's length; once per second it completes
 * a sample (`fps` is then fresh). When the 3-second average is under the tier's target it steps
 * quality down; after ADAPT_UP_S seconds comfortably at target it steps back up, but never past
 * the tier the user (or boot detection) chose. With `isAuto` off (the player picked High or Low)
 * it only measures.
 */
export class AdaptiveQuality {
  readonly settings: QualitySettings = {
    renderScale: 1,
    shadows: false,
    bloom: false,
    nameTagDistanceM: NAME_TAG_MAX_DISTANCE_M,
    streamRadiusM: TEXTURE_STREAM_RADIUS_M,
  };
  /** Frames per second over the last completed sample. */
  fps = 0;
  #tier: QualityTier;
  #isAuto = true;
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

  get isAuto(): boolean {
    return this.#isAuto;
  }

  /** A new chosen tier resets to its best settings. */
  setTier(tier: QualityTier): void {
    this.#tier = tier;
    this.#setLevel(0);
  }

  /** Off: the chosen tier's best settings, kept whatever the frame rate. */
  setAuto(isAuto: boolean): void {
    this.#isAuto = isAuto;
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
    if (this.#isAuto) this.#decide(this.fps);
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
