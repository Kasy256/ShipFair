import { describe, expect, it } from 'vitest';
import { FOV_DEFAULT_DEG } from '../constants.ts';
import { DEFAULT_PLAYER_SETTINGS, PlayerSettings } from './settings.ts';

describe('PlayerSettings', () => {
  it('defaults everything from nothing', () => {
    expect(DEFAULT_PLAYER_SETTINGS).toEqual({
      quality: 'auto',
      renderScale: 1,
      fovDeg: FOV_DEFAULT_DEG,
      volume: 1,
    });
  });

  it('keeps valid values and replaces only the bad ones', () => {
    const parsed = PlayerSettings.parse({
      quality: 'low',
      renderScale: 0.2,
      fovDeg: 70,
      volume: 'loud',
      extra: true,
    });
    expect(parsed).toEqual({ quality: 'low', renderScale: 1, fovDeg: 70, volume: 1 });
  });

  it('rejects non-objects (the caller falls back to the defaults)', () => {
    expect(PlayerSettings.safeParse('auto').success).toBe(false);
    expect(PlayerSettings.safeParse(null).success).toBe(false);
  });
});
