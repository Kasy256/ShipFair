import { describe, expect, it } from 'vitest';
import { ADAPT_UP_S, ADAPT_WINDOW_S } from '../config.ts';
import { AdaptiveQuality, maxLevel, type QualitySettings, settingsFor } from './adaptive.ts';
import { type DeviceInfo, guessTier, tierAfterBenchmark, tierFromQuery } from './detect.ts';

const desktop: DeviceInfo = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  screenWidth: 1920,
  screenHeight: 1080,
  maxTouchPoints: 0,
  cores: 8,
  memoryGb: 8,
};

describe('guessTier', () => {
  it('picks high for a typical desktop', () => {
    expect(guessTier(desktop)).toBe('high');
    expect(guessTier({ ...desktop, cores: undefined, memoryGb: undefined })).toBe('high');
  });

  it('picks low for phones and tablets, including iPadOS desktop UAs', () => {
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/140 Mobile Safari/537.36';
    expect(guessTier({ ...desktop, userAgent: android })).toBe('low');
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15';
    expect(guessTier({ ...desktop, userAgent: ipad, maxTouchPoints: 5 })).toBe('low');
    expect(guessTier({ ...desktop, userAgent: ipad, maxTouchPoints: 0 })).toBe('high');
  });

  it('picks low for small screens, little memory or few cores', () => {
    expect(guessTier({ ...desktop, screenWidth: 800, screenHeight: 1280 })).toBe('low');
    expect(guessTier({ ...desktop, memoryGb: 2 })).toBe('low');
    expect(guessTier({ ...desktop, cores: 2 })).toBe('low');
  });
});

describe('tierAfterBenchmark / tierFromQuery', () => {
  it('drops high to low on a slow benchmark, never raises low', () => {
    expect(tierAfterBenchmark('high', 16.7)).toBe('high');
    expect(tierAfterBenchmark('high', 40)).toBe('low');
    expect(tierAfterBenchmark('low', 5)).toBe('low');
  });

  it('reads ?quality=', () => {
    expect(tierFromQuery('?quality=low')).toBe('low');
    expect(tierFromQuery('?quality=high&debug=perf')).toBe('high');
    expect(tierFromQuery('?quality=ultra')).toBeUndefined();
    expect(tierFromQuery('')).toBeUndefined();
  });
});

describe('settingsFor', () => {
  const s = (): QualitySettings => ({ renderScale: 0, shadows: false, bloom: false });

  it('walks high down: scale 1 → 0.75 → 0.6, then shadows, then bloom', () => {
    const steps = Array.from({ length: maxLevel('high') + 1 }, (_, l) => ({
      ...settingsFor('high', l, s()),
    }));
    expect(steps).toEqual([
      { renderScale: 1, shadows: true, bloom: true },
      { renderScale: 0.75, shadows: true, bloom: true },
      { renderScale: 0.6, shadows: true, bloom: true },
      { renderScale: 0.6, shadows: false, bloom: true },
      { renderScale: 0.6, shadows: false, bloom: false },
    ]);
  });

  it('low never has shadows or bloom and stops at 0.6', () => {
    expect(maxLevel('low')).toBe(2);
    expect(settingsFor('low', 0, s())).toEqual({ renderScale: 1, shadows: false, bloom: false });
  });
});

describe('AdaptiveQuality', () => {
  /** Feeds `seconds` of frames at `fps`; returns how many 1 s samples completed. */
  const run = (q: AdaptiveQuality, fps: number, seconds: number) => {
    let samples = 0;
    for (let i = 0; i < Math.round(fps * seconds); i++) if (q.frame(1000 / fps)) samples++;
    return samples;
  };

  it('samples once a second and reports fps', () => {
    const q = new AdaptiveQuality('high');
    expect(run(q, 60, 3)).toBe(3);
    expect(q.fps).toBeCloseTo(60, 0);
    expect(q.level).toBe(0);
  });

  it(`steps down after a slow ${ADAPT_WINDOW_S}-second average, one level at a time`, () => {
    const q = new AdaptiveQuality('high');
    run(q, 40, ADAPT_WINDOW_S - 1);
    expect(q.level).toBe(0);
    run(q, 40, 1);
    expect(q.level).toBe(1);
    expect(q.settings.renderScale).toBe(0.75);
    run(q, 40, ADAPT_WINDOW_S * 10);
    expect(q.level).toBe(maxLevel('high'));
    expect(q.settings).toEqual({ renderScale: 0.6, shadows: false, bloom: false });
  });

  it(`steps back up after ${ADAPT_UP_S} good seconds, but never above the chosen tier`, () => {
    const q = new AdaptiveQuality('low');
    run(q, 20, ADAPT_WINDOW_S);
    expect(q.level).toBe(1);
    run(q, 30, ADAPT_UP_S);
    expect(q.level).toBe(0);
    run(q, 60, ADAPT_UP_S * 3);
    expect(q.level).toBe(0);
    expect(q.tier).toBe('low');
    expect(q.settings.shadows).toBe(false);
  });

  it('ignores hidden-tab frames and resets on a new tier', () => {
    const q = new AdaptiveQuality('high');
    expect(q.frame(5000)).toBe(false);
    run(q, 30, ADAPT_WINDOW_S);
    expect(q.level).toBe(1);
    q.setTier('low');
    expect(q.level).toBe(0);
    expect(q.settings.bloom).toBe(false);
  });
});
