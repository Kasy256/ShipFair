import type { Engine } from '@shipfair/engine';
import { useEffect, useRef } from 'react';
import { loadEngineModule } from '../lib/engine-loader.ts';
import { useSettingsStore } from './settings-store.ts';
import { useUiStore } from './ui-store.ts';

/**
 * Applies the settings menu to the engine as it changes (WorldCanvas passes the values the
 * engine starts with). A quality choice made in the menu replaces `?quality=`; until then a
 * forced tier from the URL stays.
 */
export function useEngineSettings(engine: Engine | undefined): void {
  const settings = useSettingsStore((s) => s.settings);
  const isReducedMotion = useUiStore((s) => s.isReducedMotion);
  const appliedQuality = useRef(settings.quality);

  useEffect(() => {
    engine?.applySettings({
      renderScale: settings.renderScale,
      fovDeg: settings.fovDeg,
      volume: settings.volume,
      isReducedMotion,
    });
  }, [engine, settings.renderScale, settings.fovDeg, settings.volume, isReducedMotion]);

  useEffect(() => {
    const quality = settings.quality;
    if (!engine || quality === appliedQuality.current) return;
    appliedQuality.current = quality;
    if (quality !== 'auto') {
      engine.setQuality(quality);
      engine.applySettings({ isAutoQuality: false });
      return;
    }
    loadEngineModule().then(
      (mod) => {
        if (engine.isDisposed || useSettingsStore.getState().settings.quality !== 'auto') return;
        engine.setQuality(mod.guessTier(mod.readDeviceInfo()));
        engine.applySettings({ isAutoQuality: true });
      },
      (error: unknown) => console.warn('Could not switch to automatic quality', error),
    );
  }, [engine, settings.quality]);
}

/**
 * A hidden tab (another tab, a locked phone) renders nothing and only keeps the realtime
 * connection alive with heartbeats (prompt 14).
 */
export function useHiddenPause(engine: Engine | undefined): void {
  useEffect(() => {
    if (!engine) return;
    const apply = () => engine.setHidden(document.visibilityState === 'hidden');
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => document.removeEventListener('visibilitychange', apply);
  }, [engine]);
}
