import { useEffect } from 'react';
import { fetchMyBooths } from '../lib/booth-api.ts';
import { boothNotices, SeenBooths } from '../lib/booth-notices.ts';
import { loadSupabase } from '../lib/supabase.ts';
import { useSessionStore } from './session-store.ts';
import { useUiStore } from './ui-store.ts';

const storageKey = (userId: string) => `shipfair:booth-notices:${userId}`;

function readSeen(userId: string): SeenBooths {
  try {
    const parsed = SeenBooths.safeParse(
      JSON.parse(localStorage.getItem(storageKey(userId)) ?? '{}'),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function writeSeen(userId: string, seen: SeenBooths): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(seen));
  } catch (error) {
    console.warn('Could not remember booth notices; they may repeat next visit', error);
  }
}

/**
 * Once the maker is in the city, toasts review results they haven't heard about yet: "is live",
 * "needs changes: …", edits approved or rejected (prompt 09 §8). Email comes later.
 */
export function useBoothNotices(hasEntered: boolean): void {
  const userId = useSessionStore((s) => (s.status === 'signed-in' ? s.userId : null));

  useEffect(() => {
    if (!hasEntered || !userId) return;
    let isCurrent = true;
    (async () => {
      const client = await loadSupabase();
      if (!client) return;
      const booths = await fetchMyBooths(client, userId);
      if (!isCurrent) return;
      const { notices, seen } = boothNotices(booths, readSeen(userId));
      writeSeen(userId, seen);
      const { showToast } = useUiStore.getState();
      for (const notice of notices) showToast(notice);
    })().catch((error: unknown) => console.warn('Booth notices unavailable', error));
    return () => {
      isCurrent = false;
    };
  }, [hasEntered, userId]);
}
