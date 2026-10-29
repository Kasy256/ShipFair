import * as z from 'zod';
import { create } from 'zustand';
import { prefersReducedMotion } from '../lib/device.ts';

/** How long a toast stays up. */
export const TOAST_MS = 3500;
const REDUCED_MOTION_KEY = 'shipfair:reduced-motion';

export interface Toast {
  id: number;
  text: string;
}

interface UiState {
  /** The booth whose panel is open. */
  openBoothId: string | null;
  isMapOpen: boolean;
  isHelpOpen: boolean;
  /** The plaza kiosk's "Claim a booth" sheet. */
  isClaimOpen: boolean;
  isReducedMotion: boolean;
  toasts: readonly Toast[];
  openBooth(id: string): void;
  closeBooth(): void;
  setMapOpen(isOpen: boolean): void;
  setHelpOpen(isOpen: boolean): void;
  setClaimOpen(isOpen: boolean): void;
  setReducedMotion(isReduced: boolean): void;
  showToast(text: string): void;
  dismissToast(id: number): void;
}

/** The saved choice, else the OS setting. localStorage is input too, so it is parsed. */
function initialReducedMotion(): boolean {
  try {
    const saved = z
      .boolean()
      .safeParse(JSON.parse(localStorage.getItem(REDUCED_MOTION_KEY) ?? 'null'));
    if (saved.success) return saved.data;
  } catch {
    // No storage (private mode, Node tests) or bad JSON: fall back to the OS setting.
  }
  return typeof window !== 'undefined' && prefersReducedMotion();
}

let nextToastId = 1;

/** Panels, overlays, toasts and the reduced-motion setting. */
export const useUiStore = create<UiState>()((set, get) => ({
  openBoothId: null,
  isMapOpen: false,
  isHelpOpen: false,
  isClaimOpen: false,
  isReducedMotion: initialReducedMotion(),
  toasts: [],
  // One overlay at a time: opening a booth closes the map, and the other way round.
  openBooth: (id) => set({ openBoothId: id, isMapOpen: false, isClaimOpen: false }),
  closeBooth: () => set({ openBoothId: null }),
  setMapOpen: (isOpen) =>
    set(isOpen ? { isMapOpen: true, openBoothId: null, isClaimOpen: false } : { isMapOpen: false }),
  setHelpOpen: (isOpen) => set({ isHelpOpen: isOpen }),
  setClaimOpen: (isOpen) =>
    set(
      isOpen ? { isClaimOpen: true, openBoothId: null, isMapOpen: false } : { isClaimOpen: false },
    ),
  setReducedMotion(isReduced) {
    set({ isReducedMotion: isReduced });
    try {
      localStorage.setItem(REDUCED_MOTION_KEY, JSON.stringify(isReduced));
    } catch (error) {
      console.warn('Could not save the reduced-motion setting', error);
    }
  },
  showToast(text) {
    const id = nextToastId++;
    set({ toasts: [...get().toasts, { id, text }] });
    setTimeout(() => get().dismissToast(id), TOAST_MS);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** True while anything modal is up (the engine's input is off then). */
export const selectIsOverlayOpen = (s: UiState): boolean =>
  s.openBoothId !== null || s.isMapOpen || s.isClaimOpen;
