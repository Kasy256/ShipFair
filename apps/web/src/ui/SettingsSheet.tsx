import {
  FOV_MAX_DEG,
  FOV_MIN_DEG,
  type QualityMode,
  RENDER_SCALE_MAX,
  RENDER_SCALE_MIN,
} from '@shipfair/shared';
import type { ChangeEvent } from 'react';
import { useSettingsStore } from '../state/settings-store.ts';
import { useUiStore } from '../state/ui-store.ts';
import { Sheet } from './Sheet.tsx';

const QUALITY: { mode: QualityMode; label: string; hint: string }[] = [
  { mode: 'auto', label: 'Auto', hint: 'Picks for your device and lowers detail if it slows down' },
  { mode: 'high', label: 'High', hint: 'Shadows, glow and sharper images' },
  { mode: 'low', label: 'Low', hint: 'Smoother on phones and older laptops' },
];

const percent = (value: number) => `${Math.round(value * 100)}%`;
const numberFrom = (e: ChangeEvent<HTMLInputElement>) => Number(e.currentTarget.value);

/**
 * Settings (prompt 14): quality, render scale, field of view, sound volume and reduced motion.
 * Every change applies at once and is saved in this browser.
 */
export function SettingsSheet() {
  const isOpen = useUiStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const isReducedMotion = useUiStore((s) => s.isReducedMotion);
  const setReducedMotion = useUiStore((s) => s.setReducedMotion);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);
  const slider = 'mt-2 w-full accent-accent';
  const row = 'mt-5 block';

  return (
    <Sheet
      isOpen={isOpen}
      onClose={() => setSettingsOpen(false)}
      labelledBy="settings-title"
      variant="side"
      testId="settings-sheet"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id="settings-title" className="font-bold text-2xl">
          Settings
        </h2>
        <button
          type="button"
          onClick={() => setSettingsOpen(false)}
          className="rounded-lg bg-ink-3 px-3 py-1.5 font-semibold text-sm hover:bg-ink"
        >
          Done
        </button>
      </div>

      <fieldset className="mt-4">
        <legend className="font-semibold">Quality</legend>
        <div className="mt-2 grid gap-2">
          {QUALITY.map(({ mode, label, hint }) => (
            <label
              key={mode}
              className="flex cursor-pointer items-start gap-3 rounded-xl bg-ink-3 p-3 has-[:checked]:ring-2 has-[:checked]:ring-accent"
            >
              <input
                type="radio"
                name="quality"
                value={mode}
                checked={settings.quality === mode}
                onChange={() => update({ quality: mode })}
                className="mt-1 accent-accent"
              />
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block text-muted text-sm">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className={row}>
        <span className="flex justify-between font-semibold">
          Render scale{' '}
          <output className="text-muted tabular-nums">{percent(settings.renderScale)}</output>
        </span>
        <input
          type="range"
          min={RENDER_SCALE_MIN}
          max={RENDER_SCALE_MAX}
          step={0.05}
          value={settings.renderScale}
          onChange={(e) => update({ renderScale: numberFrom(e) })}
          className={slider}
        />
        <span className="block text-muted text-sm">Lower is blurrier but faster.</span>
      </label>

      <label className={row}>
        <span className="flex justify-between font-semibold">
          Field of view <output className="text-muted tabular-nums">{settings.fovDeg}°</output>
        </span>
        <input
          type="range"
          min={FOV_MIN_DEG}
          max={FOV_MAX_DEG}
          step={1}
          value={settings.fovDeg}
          onChange={(e) => update({ fovDeg: numberFrom(e) })}
          className={slider}
        />
      </label>

      <label className={row}>
        <span className="flex justify-between font-semibold">
          Sound volume{' '}
          <output className="text-muted tabular-nums">{percent(settings.volume)}</output>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.volume}
          onChange={(e) => update({ volume: numberFrom(e) })}
          className={slider}
        />
      </label>

      <label className="mt-5 flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={isReducedMotion}
          onChange={(e) => setReducedMotion(e.currentTarget.checked)}
          className="h-4 w-4 accent-accent"
        />
        <span>
          <span className="block font-semibold">Reduced motion</span>
          <span className="block text-muted text-sm">
            No booth build-up, banner or stamp animations.
          </span>
        </span>
      </label>

      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg bg-ink-3 px-3 py-1.5 font-semibold text-sm hover:bg-ink"
      >
        Reset to defaults
      </button>
    </Sheet>
  );
}
