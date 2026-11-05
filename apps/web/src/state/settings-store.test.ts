import { DEFAULT_PLAYER_SETTINGS } from '@shipfair/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, useSettingsStore } from './settings-store.ts';

/** A Map-backed localStorage for Node. */
function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

describe('settings store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
    useSettingsStore.getState().reset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves changes and loads them back', () => {
    useSettingsStore.getState().update({ quality: 'low', fovDeg: 72 });
    expect(useSettingsStore.getState().settings).toMatchObject({ quality: 'low', fovDeg: 72 });
    expect(loadSettings()).toEqual({ ...DEFAULT_PLAYER_SETTINGS, quality: 'low', fovDeg: 72 });
  });

  it('replaces an out-of-range value with its default', () => {
    useSettingsStore.getState().update({ renderScale: 3 });
    expect(useSettingsStore.getState().settings.renderScale).toBe(1);
  });

  it('loads the defaults from broken storage', () => {
    localStorage.setItem('shipfair:settings', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_PLAYER_SETTINGS);
    localStorage.setItem('shipfair:settings', '"auto"');
    expect(loadSettings()).toEqual(DEFAULT_PLAYER_SETTINGS);
  });
});
