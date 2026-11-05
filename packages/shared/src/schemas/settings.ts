import * as z from 'zod';
import {
  FOV_DEFAULT_DEG,
  FOV_MAX_DEG,
  FOV_MIN_DEG,
  RENDER_SCALE_MAX,
  RENDER_SCALE_MIN,
} from '../constants.ts';

/** Auto: the detected tier, stepped down when frames are slow. High or Low: fixed. */
export const QualityMode = z.enum(['auto', 'high', 'low']);
export type QualityMode = z.infer<typeof QualityMode>;

/**
 * The settings menu (prompt 14), saved in localStorage. Every field falls back to its default on
 * its own, so one bad or out-of-range value never resets the rest. Reduced motion is kept apart
 * (it predates this menu and follows the OS setting until changed).
 */
export const PlayerSettings = z.object({
  quality: QualityMode.catch('auto'),
  renderScale: z.number().min(RENDER_SCALE_MIN).max(RENDER_SCALE_MAX).catch(RENDER_SCALE_MAX),
  fovDeg: z.number().min(FOV_MIN_DEG).max(FOV_MAX_DEG).catch(FOV_DEFAULT_DEG),
  volume: z.number().min(0).max(1).catch(1),
});
export type PlayerSettings = z.infer<typeof PlayerSettings>;

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = PlayerSettings.parse({});
