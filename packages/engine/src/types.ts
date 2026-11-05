import type {
  AvatarStyleV2,
  BoothChange,
  EventBus,
  QualityTier,
  Teleport,
  WorldSnapshot,
} from '@shipfair/shared';
import type { DebugFlag } from './debug/perf-overlay.ts';

export type { BoothChange, EventBus, QualityTier, Teleport, WorldSnapshot };

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  quality: QualityTier;
  bus: EventBus;
  /** No rAF: the world only moves through `engine.step(dt, n)`. For e2e and unit tests. */
  isTestMode?: boolean;
  /**
   * Automatic quality: the boot benchmark may lower `quality`, and the adaptive controller steps
   * settings down when frames are slow. Off when the player (or `?quality=`) picked a tier.
   * Change it later with `setAutoQuality`. Default true.
   */
  isAutoQuality?: boolean;
  /** The settings menu's render scale (RENDER_SCALE_MIN..1). Default 1. */
  renderScale?: number;
  /** Vertical field of view in landscape, degrees (FOV_MIN_DEG..FOV_MAX_DEG). */
  fovDeg?: number;
  /** Master volume, 0..1. Default 1. */
  volume?: number;
  debug?: ReadonlySet<DebugFlag>;
  avatarStyle?: AvatarStyleV2;
  /** Name tag text for the local player (a handle or Guest-####). Change it with `setLocalPlayer`. */
  playerName?: string;
  /** Host booth images load from (VITE_MEDIA_HOST). Without it booths show monograms only. */
  mediaHost?: string | null;
  /** Reduced motion: no booth build-up animation. Change it later with `applySettings`. */
  isReducedMotion?: boolean;
}

/** The settings menu's engine-side values (prompt 14). See `Engine.applySettings`. */
export interface EngineSettings {
  /** Auto: slow frames step settings down (never above `quality`). Off for a chosen High or Low. */
  isAutoQuality: boolean;
  /** RENDER_SCALE_MIN..1, on top of the adaptive render scale. */
  renderScale: number;
  /** Vertical field of view in landscape, degrees; portrait screens widen it. */
  fovDeg: number;
  /** Master volume, 0..1. */
  volume: number;
  /** No booth build-up animation. */
  isReducedMotion: boolean;
}

/** What `start()` is doing, in order, for a loading screen's progress bar. */
export type StartStage = 'physics' | 'city' | 'shaders' | 'ready';

/** Where the player is, for the web shell's minimap. Filled once per frame; read it, don't keep it. */
export interface PlayerView {
  x: number;
  z: number;
  /** The way the avatar faces: the look direction is (sin yaw, cos yaw). */
  yaw: number;
  /** The way the camera looks, same convention. */
  cameraYaw: number;
}
