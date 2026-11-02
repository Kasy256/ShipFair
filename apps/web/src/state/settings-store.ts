import { DEFAULT_PLAYER_SETTINGS, PlayerSettings } from '@shipfair/shared';
import { create } from 'zustand';

const SETTINGS_KEY = 'shipfair:settings';

/** The saved settings, parsed (localStorage is input too). Defaults when missing or broken. */
export function loadSettings(): PlayerSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return DEFAULT_PLAYER_SETTINGS;
    const parsed = PlayerSettings.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PLAYER_SETTINGS;
  } catch {
    // No storage (private mode, Node tests) or bad JSON: the defaults.
    return DEFAULT_PLAYER_SETTINGS;
  }
}

interface SettingsState {
  settings: PlayerSettings;
  /** Changes some settings and saves them all. */
  update(patch: Partial<PlayerSettings>): void;
  reset(): void;
}

function save(settings: PlayerSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Could not save the settings', error);
  }
}

/** The settings menu (prompt 14): quality, render scale, field of view, volume. */
export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: loadSettings(),
  update(patch) {
    const settings = PlayerSettings.parse({ ...get().settings, ...patch });
    set({ settings });
    save(settings);
  },
  reset() {
    set({ settings: DEFAULT_PLAYER_SETTINGS });
    save(DEFAULT_PLAYER_SETTINGS);
  },
}));
