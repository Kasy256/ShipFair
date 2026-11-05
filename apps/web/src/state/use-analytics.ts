import { useEffect } from 'react';
import {
  applyAnalyticsMode,
  setAnalyticsContext,
  setBoothDistrictResolver,
} from '../lib/analytics.ts';
import { isCoarsePointer } from '../lib/device.ts';
import { useSettingsStore } from './settings-store.ts';
import { useWorldStore } from './world-store.ts';

const districtSlug = (id: number | null) =>
  id === null ? 'plaza' : (useWorldStore.getState().districtsById.get(id)?.slug ?? 'plaza');

/**
 * Keeps analytics in step with Settings (the consent mode) and the world (district context).
 * Mounted once, in RootLayout.
 */
export function useAnalytics(): void {
  const mode = useSettingsStore((s) => s.settings.analytics);
  useEffect(() => applyAnalyticsMode(mode), [mode]);

  useEffect(() => {
    setAnalyticsContext({ deviceClass: isCoarsePointer() ? 'touch' : 'desktop' });
    setBoothDistrictResolver((boothId) => {
      const world = useWorldStore.getState();
      const booth = world.boothsById.get(boothId);
      return booth ? world.districtsById.get(booth.districtId)?.slug : undefined;
    });
    setAnalyticsContext({ district: districtSlug(useWorldStore.getState().currentDistrictId) });
    return useWorldStore.subscribe((state, previous) => {
      if (state.currentDistrictId !== previous.currentDistrictId) {
        setAnalyticsContext({ district: districtSlug(state.currentDistrictId) });
      }
    });
  }, []);
}
