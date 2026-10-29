import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { fetchOwnProfile, ProfileError } from '../lib/profile-api.ts';
import { loadSupabase, type Supabase } from '../lib/supabase.ts';
import { authToastText } from '../ui/errors.ts';
import { selectNeedsOnboarding, useSessionStore } from './session-store.ts';
import { useUiStore } from './ui-store.ts';

/** Set by `signOut()` so a deliberate sign-out isn't reported as an expired session. */
let isSigningOut = false;

/** Signs out of this browser only (other devices keep their sessions) and returns to guest. */
export async function signOut(): Promise<void> {
  const client = await loadSupabase();
  if (!client) return;
  isSigningOut = true;
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) console.warn('Sign-out reported an error; the local session is cleared', error);
  } finally {
    useSessionStore.getState().setGuest();
    isSigningOut = false;
  }
}

/** The current access token, for `/api` calls that need the user (e.g. account deletion). */
export async function accessToken(): Promise<string | null> {
  const client = await loadSupabase();
  const { data } = (await client?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.access_token ?? null;
}

async function applySession(client: Supabase, event: AuthChangeEvent, session: Session | null) {
  const store = useSessionStore.getState();
  const ui = useUiStore.getState();
  const user = session?.user;
  if (!user) {
    // A refresh that fails for good ends in SIGNED_OUT: say so, then carry on as a guest.
    if (event === 'SIGNED_OUT' && store.status === 'signed-in' && !isSigningOut) {
      ui.showToast(authToastText('session_ended'));
    }
    store.setGuest();
    ui.setOnboardingOpen(false);
    return;
  }
  // Token refreshes and focus re-checks for the same user need no profile reload.
  if (store.status === 'signed-in' && store.userId === user.id && store.profile) return;
  try {
    const profile = await fetchOwnProfile(client, user.id);
    store.setSignedIn(user.id, profile);
    if (selectNeedsOnboarding(useSessionStore.getState())) ui.setOnboardingOpen(true);
  } catch (error) {
    console.error('Could not load the profile; continuing as a guest', error);
    ui.showToast(authToastText('profile_unavailable'));
    // A missing row means the account is gone (deleted elsewhere): drop the session too.
    if (error instanceof ProfileError && error.code === 'not_found') void signOut();
    else store.setGuest();
  }
}

/**
 * Keeps `useSessionStore` in step with Supabase Auth: the restored session on load, sign-in,
 * sign-out and refresh failures. Never throws into React: any failure leaves a working guest.
 * Mounted once, at the root.
 */
export function useAuthSync(): void {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let isCurrent = true;
    loadSupabase().then(
      (client) => {
        if (!isCurrent) return;
        if (!client) {
          useSessionStore.getState().setGuest();
          return;
        }
        const { data } = client.auth.onAuthStateChange((event, session) => {
          // supabase-js holds a lock while it calls listeners; calling it back from inside
          // would deadlock, so the work runs on the next tick.
          setTimeout(() => {
            applySession(client, event, session).catch((error: unknown) =>
              console.error('Session update failed', error),
            );
          }, 0);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      },
      (error: unknown) => {
        console.error('Sign-in is unavailable (Supabase client failed to load)', error);
        useSessionStore.getState().setGuest();
      },
    );
    return () => {
      isCurrent = false;
      unsubscribe?.();
    };
  }, []);
}
