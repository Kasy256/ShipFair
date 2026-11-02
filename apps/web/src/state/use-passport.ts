import { boothMilestones, DISTRICT_STAMP_DWELL_S, type StampKey } from '@shipfair/shared';
import { useEffect } from 'react';
import { claimStamps, fetchStamps, mergeGuestStamps } from '../lib/passport-api.ts';
import { friendShard } from '../lib/realtime.ts';
import { loadSupabase } from '../lib/supabase.ts';
import { stampInfo } from '../ui/passport/stamp-info.ts';
import { engineBus } from './engine-bus.ts';
import { selectPending, usePassportStore } from './passport-store.ts';
import { useSessionStore } from './session-store.ts';
import { useUiStore } from './ui-store.ts';
import { useWorldStore } from './world-store.ts';

/** Claims are sent in small batches shortly after they're earned. */
const CLAIM_DELAY_MS = 1500;
/** Pending stamps are re-checked after a shard has had time to report (it does every 60 s). */
const PENDING_RETRY_MS = 75_000;
const PENDING_RETRIES_MAX = 8;
const BATCH_MAX = 8;

async function accessToken(): Promise<string | null> {
  const client = await loadSupabase();
  const { data } = (await client?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.access_token ?? null;
}

/** A new stamp: into the passport, with a toast. Components call it for UI-only moments. */
export function earnStamp(stamp: StampKey): void {
  if (!usePassportStore.getState().earn(stamp)) return;
  const districts = [...useWorldStore.getState().districtsById.values()];
  useUiStore.getState().showToast(`Passport stamp: ${stampInfo(stamp, districts).title}`);
}

/**
 * Earns passport stamps as the visitor plays (prompt 13) and keeps a signed-in user's passport in
 * step with the server: guest stamps are offered for merge once after sign-in, new ones are
 * claimed in small batches, and pending ones are re-checked after the shard's next report.
 */
export function usePassport(hasEntered: boolean, search: string): void {
  const status = useSessionStore((s) => s.status);
  const userId = useSessionStore((s) => s.userId);
  const guestId = useSessionStore((s) => s.guest.id);

  // Earning: district dwell, booths opened, makers met, first upvote, chat, a friend's shard.
  useEffect(() => {
    if (!hasEntered) return;
    let dwell: ReturnType<typeof setTimeout> | undefined;
    const offs = [
      engineBus.on('zone:entered', ({ districtId }) => {
        clearTimeout(dwell);
        if (districtId === null) return;
        dwell = setTimeout(() => {
          const slug = useWorldStore.getState().districtsById.get(districtId)?.slug;
          if (slug && useWorldStore.getState().currentDistrictId === districtId) {
            earnStamp(`district:${slug}` as StampKey);
          }
        }, DISTRICT_STAMP_DWELL_S * 1000);
      }),
      engineBus.on('booth:upvoted', () => earnStamp('first:upvote')),
      engineBus.on('chat:incoming', ({ isYou }) => {
        if (isYou) earnStamp('first:chat');
      }),
    ];
    const isFriendLink = friendShard(search) !== null;
    const checkPlace = () => {
      const world = useWorldStore.getState();
      const boothId = useUiStore.getState().openBoothId;
      if (isFriendLink && world.netStatus === 'online') earnStamp('squad');
      if (!boothId) return;
      const booth = world.boothsById.get(boothId);
      const me = useSessionStore.getState().userId;
      if (world.makersHere.has(boothId) && booth && booth.ownerId !== me) earnStamp('met-a-maker');
    };
    let lastOpened: string | null = null;
    const unsubUi = useUiStore.subscribe((ui) => {
      if (ui.openBoothId && ui.openBoothId !== lastOpened) {
        const count = usePassportStore.getState().markOpened(ui.openBoothId);
        for (const stamp of boothMilestones(count)) earnStamp(stamp);
      }
      lastOpened = ui.openBoothId;
      checkPlace();
    });
    const unsubWorld = useWorldStore.subscribe(checkPlace);
    checkPlace();
    return () => {
      clearTimeout(dwell);
      for (const off of offs) off();
      unsubUi();
      unsubWorld();
    };
  }, [hasEntered, search]);

  // Whose passport: the guest's, or the signed-in user's (merging the guest's in once).
  useEffect(() => {
    if (status === 'loading') return;
    const passport = usePassportStore.getState;
    if (status !== 'signed-in' || !userId) {
      passport().switchTo(null);
      return;
    }
    passport().switchTo(userId);
    let isCancelled = false;
    (async () => {
      const token = await accessToken();
      const client = await loadSupabase();
      if (!token || !client || isCancelled) return;
      const claims = passport().guestClaims();
      if (claims.length > 0) {
        const answer = await mergeGuestStamps(token, guestId, claims);
        if (isCancelled) return;
        passport().clearGuest();
        for (const stamp of [...answer.awarded, ...answer.pending]) passport().earn(stamp);
        passport().takeQueue();
        passport().applyAnswer(claims, answer);
      }
      const stamps = await fetchStamps(client, userId);
      if (!isCancelled) passport().setServerStamps(stamps);
    })().catch((error: unknown) => console.warn('Passport sync failed', error));
    return () => {
      isCancelled = true;
    };
  }, [status, userId, guestId]);

  // Claims: batched shortly after earning; pending ones re-checked a few times.
  useEffect(() => {
    if (status !== 'signed-in' || !userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const send = async (stamps: StampKey[]) => {
      const token = await accessToken();
      if (!token || stamps.length === 0) return;
      for (let i = 0; i < stamps.length; i += BATCH_MAX) {
        const batch = stamps.slice(i, i + BATCH_MAX);
        usePassportStore.getState().applyAnswer(batch, await claimStamps(token, batch));
      }
    };
    const flush = () => {
      send(usePassportStore.getState().takeQueue()).catch((error: unknown) =>
        console.warn('Stamp claim failed; it will be retried', error),
      );
    };
    const unsub = usePassportStore.subscribe((s, before) => {
      if (s.queue.length > 0 && s.queue !== before.queue) {
        clearTimeout(timer);
        timer = setTimeout(flush, CLAIM_DELAY_MS);
      }
    });
    const retry = setInterval(() => {
      const pending = selectPending(usePassportStore.getState());
      if (pending.length === 0 || retries >= PENDING_RETRIES_MAX) return;
      retries++;
      send(pending).catch((error: unknown) => console.warn('Pending stamps not checked', error));
    }, PENDING_RETRY_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(retry);
      unsub();
    };
  }, [status, userId]);
}
