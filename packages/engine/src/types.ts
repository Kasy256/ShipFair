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
  /** Host booth images load from (VITE_MEDIA_HOST). Without it booths show monograms only. */
  mediaHost?: string | null;
}
