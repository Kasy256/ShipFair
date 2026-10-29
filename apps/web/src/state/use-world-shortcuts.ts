import { useEffect } from 'react';
import { isTypingTarget } from '../lib/device.ts';
import { useUiStore } from './ui-store.ts';

/** `M` toggles the map and `?` the controls help, unless the user is typing in a field. */
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
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActive]);
}
