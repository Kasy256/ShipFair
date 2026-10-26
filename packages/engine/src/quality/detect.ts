import type { QualityTier } from '@shipfair/shared';
import {
  BENCHMARK_LOW_MS,
  LOW_TIER_MAX_CORES,
  LOW_TIER_MAX_MEMORY_GB,
  LOW_TIER_MAX_SCREEN_PX,
} from '../config.ts';

export interface DeviceInfo {
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  maxTouchPoints: number;
  /** `navigator.hardwareConcurrency`, when the browser reports it. */
  cores?: number | undefined;
  /** `navigator.deviceMemory` in GB (Chromium only, capped at 8). */
  memoryGb?: number | undefined;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i;

export function isMobileDevice(info: DeviceInfo): boolean {
  // iPadOS reports a desktop Safari UA; touch points give it away.
  const isIpadOs = /Macintosh/.test(info.userAgent) && info.maxTouchPoints > 1;
  return MOBILE_UA.test(info.userAgent) || isIpadOs;
}

/** Boot guess from the user agent, screen and hardware hints. Pure, so it is unit tested. */
export function guessTier(info: DeviceInfo): QualityTier {
  if (isMobileDevice(info)) return 'low';
  if (Math.min(info.screenWidth, info.screenHeight) <= LOW_TIER_MAX_SCREEN_PX) return 'low';
  if (info.memoryGb !== undefined && info.memoryGb < LOW_TIER_MAX_MEMORY_GB) return 'low';
  if (info.cores !== undefined && info.cores <= LOW_TIER_MAX_CORES) return 'low';
  return 'high';
}

/** After the boot benchmark: a slow average frame drops `high` to `low`, never the reverse. */
export function tierAfterBenchmark(tier: QualityTier, averageFrameMs: number): QualityTier {
  return tier === 'high' && averageFrameMs > BENCHMARK_LOW_MS ? 'low' : tier;
}

/** Reads `DeviceInfo` from the browser. */
export function readDeviceInfo(): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    screenWidth: screen.width,
    screenHeight: screen.height,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
  };
}

/** A `?quality=high|low` override, for testing and for people who know their machine. */
export function tierFromQuery(search: string): QualityTier | undefined {
  const value = new URLSearchParams(search).get('quality');
  return value === 'high' || value === 'low' ? value : undefined;
}
