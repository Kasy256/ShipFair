import { fakeWorld } from '@shipfair/shared/fake-world';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectIsOverlayOpen, TOAST_MS, useUiStore } from './ui-store.ts';
import { useWorldStore } from './world-store.ts';

describe('useWorldStore', () => {
  it('indexes the snapshot by id and slug and resets focus', () => {
    const snapshot = fakeWorld(5);
    useWorldStore.getState().setFocusedBooth('stale');
    useWorldStore.getState().setWorld({ snapshot, mediaHost: 'media.test' });
    const s = useWorldStore.getState();
    const [first] = snapshot.booths;
    if (!first) throw new Error('no booth');
    expect(s.boothsById.get(first.id)).toBe(first);
    expect(s.boothsBySlug.get(first.slug)).toBe(first);
    expect(s.districtsById.size).toBe(snapshot.districts.length);
    expect(s.mediaHost).toBe('media.test');
    expect(s.focusedBoothId).toBeNull();
  });

  it('accepts the test level (no snapshot)', () => {
    useWorldStore.getState().setWorld({ snapshot: undefined, mediaHost: null });
    expect(useWorldStore.getState().snapshot).toBeNull();
    expect(useWorldStore.getState().boothsById.size).toBe(0);
  });
});

describe('useUiStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUiStore.setState({ openBoothId: null, isMapOpen: false, isClaimOpen: false, toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps one overlay open at a time', () => {
    const ui = useUiStore.getState();
    ui.setMapOpen(true);
    ui.openBooth('b1');
    expect(useUiStore.getState()).toMatchObject({ openBoothId: 'b1', isMapOpen: false });
    ui.setClaimOpen(true);
    expect(useUiStore.getState()).toMatchObject({ openBoothId: null, isClaimOpen: true });
    expect(selectIsOverlayOpen(useUiStore.getState())).toBe(true);
    ui.setClaimOpen(false);
    expect(selectIsOverlayOpen(useUiStore.getState())).toBe(false);
  });

  it('dismisses toasts after TOAST_MS', () => {
    useUiStore.getState().showToast('Link copied');
    expect(useUiStore.getState().toasts.map((t) => t.text)).toEqual(['Link copied']);
    vi.advanceTimersByTime(TOAST_MS + 1);
    expect(useUiStore.getState().toasts).toEqual([]);
  });

  it('survives having no localStorage when saving reduced motion', () => {
    useUiStore.getState().setReducedMotion(true);
    expect(useUiStore.getState().isReducedMotion).toBe(true);
  });
});
