import type { Engine } from '@shipfair/engine';
import { useEffect } from 'react';
import { selectName, selectStyle, useSessionStore } from './session-store.ts';

/**
 * Hands the engine the visitor's look and name whenever they change: a saved profile, a guest's
 * new look, or the editor's live draft (prompt 07). The engine updates the local avatar in place.
 */
export function useLocalPlayer(engine: Engine | undefined): void {
  const style = useSessionStore(selectStyle);
  const name = useSessionStore(selectName);
  useEffect(() => {
    engine?.setLocalPlayer({ style, name });
  }, [engine, style, name]);
}
