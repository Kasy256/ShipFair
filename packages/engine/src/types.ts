import type {
  AvatarStyleV2,
  EventBus,
  QualityTier,
  Teleport,
  WorldSnapshot,
} from '@shipfair/shared';
import type { DebugFlag } from './debug/perf-overlay.ts';

export type { EventBus, QualityTier, Teleport, WorldSnapshot };

/** A booth added, changed or removed since the snapshot. Shaped in prompt 05. */
export type BoothChange = Readonly<Record<string, unknown>>;

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
}
