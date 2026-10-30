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
  /** Let the boot benchmark lower `quality` (off when the user picked a tier). Default true. */
  isAutoQuality?: boolean;
  debug?: ReadonlySet<DebugFlag>;
  avatarStyle?: AvatarStyleV2;
  /** Name tag text for the local player (a handle or Guest-####). Change it with . */
  playerName?: string;
  /** Host booth images load from (VITE_MEDIA_HOST). Without it booths show monograms only. */
  mediaHost?: string | null;
  /** Reduced motion: no booth build-up animation. Change it later with `setReducedMotion`. */
  isReducedMotion?: boolean;
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
