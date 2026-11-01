import { useEffect } from 'react';
import { isTypingTarget } from '../lib/device.ts';
import { useChatStore } from './chat-store.ts';
import { selectIsOverlayOpen, useUiStore } from './ui-store.ts';

/**
 * `M` toggles the map, `?` the controls help and Enter opens the chat composer (when no panel is
 * open), unless the user is typing in a field.
 */
export function useWorldShortcuts(isActive: boolean): void {
  useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target))
        return;
      const ui = useUiStore.getState();
      if (e.key === 'm' || e.key === 'M') {
        // The booth panel and kiosk sheet keep focus until closed; M doesn't swap them out.
        if (ui.openBoothId !== null || ui.isClaimOpen) return;
        ui.setMapOpen(!ui.isMapOpen);
      } else if (e.key === '?') {
        ui.setHelpOpen(!ui.isHelpOpen);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        // Enter on a focused button or link is that control's own click.
        const onControl = e.target instanceof Element && e.target.closest('button, a') !== null;
        if (onControl || selectIsOverlayOpen(ui)) return;
        useChatStore.getState().setComposing(true);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActive]);
}
