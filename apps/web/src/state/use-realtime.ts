import type { Engine, NetConnectOptions } from '@shipfair/engine';
import { useEffect } from 'react';
import { boothChangesFor, friendShard, realtimeHost } from '../lib/realtime.ts';
import { loadSupabase } from '../lib/supabase.ts';
import { fetchWorld } from '../lib/world-source.ts';
import { engineBus } from './engine-bus.ts';
import { useSessionStore } from './session-store.ts';
import { useWorldStore } from './world-store.ts';

/** A fresh access token for each hello (supabase-js refreshes it when it is close to expiry). */
async function accessToken(): Promise<string | null> {
  const client = await loadSupabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Joins the realtime world once the visitor has entered (prompt 11): as the signed-in user or the
 * guest, in the friend's shard for `?with=w-2`. Signing in or out reconnects with the new
 * identity. Without a realtime host the city simply stays solo.
 */
export function useRealtime(engine: Engine | undefined, hasEntered: boolean, search: string): void {
  const status = useSessionStore((s) => s.status);
  const userId = useSessionStore((s) => s.userId);
  const guestId = useSessionStore((s) => s.guest.id);

  useEffect(() => {
    if (!engine || !hasEntered || status === 'loading') return;
    const host = realtimeHost(search, {
      configured: import.meta.env.VITE_REALTIME_HOST as string | undefined,
      isDev: import.meta.env.MODE !== 'production',
      pageHostname: window.location.hostname,
    });
    if (!host) return;
    const options: NetConnectOptions = {
      host,
      shard: friendShard(search),
      identity: userId ? { guestId, getToken: accessToken } : { guestId },
    };
    engine.connect(options);
    return () => engine.disconnect();
  }, [engine, hasEntered, status, userId, guestId, search]);

  // A booth was approved or changed: refetch the world and build just those booths.
  useEffect(() => {
    if (!engine) return;
    return engineBus.on('world:changed', ({ boothIds }) => {
      const ids = [...boothIds];
      fetchWorld()
        .then(({ snapshot }) => {
          if (!snapshot || engine.isDisposed) return;
          engine.updateBooths(boothChangesFor(snapshot, ids));
          useWorldStore.getState().refreshWorld(snapshot);
        })
        .catch((error: unknown) =>
          console.warn('World update skipped; the next visit has it', error),
        );
    });
  }, [engine]);
}
