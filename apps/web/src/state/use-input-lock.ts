import { useEffect } from 'react';
import { engineBus } from './engine-bus.ts';

/** Panels and forms call this so typing never moves the avatar (CODING_STANDARDS.md §5). */
export function useInputLock(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    engineBus.emit('input:enabled', { enabled: false });
    return () => engineBus.emit('input:enabled', { enabled: true });
  }, [isOpen]);
}
