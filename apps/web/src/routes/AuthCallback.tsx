import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { loadSupabase, takeReturnPath } from '../lib/supabase.ts';
import { useUiStore } from '../state/ui-store.ts';
import { authErrorFromRedirect } from '../ui/errors.ts';

/** OAuth error parameters arrive in the query (PKCE) or, from some providers, the hash. */
function redirectError(): string | null | undefined {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const has = query.has('error') || hash.has('error');
  if (!has) return undefined;
  return query.get('error_description') ?? hash.get('error_description');
}

/**
 * `/auth/callback`: where GitHub and Google send the user back. supabase-js exchanges the PKCE
 * code on load (`detectSessionInUrl`); this page waits for that, then returns to the remembered
 * path. A refusal (a banned identity, a cancelled consent) reopens the sign-in sheet with a
 * friendly message.
 */
export function AuthCallback() {
  const navigate = useNavigate();
  // Read once: StrictMode runs the effect twice, and the stored path is cleared as it is read.
  const returnPath = useRef<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    returnPath.current ??= takeReturnPath();
    const returnTo = returnPath.current;
    const fail = (description: string | null) => {
      if (!isCurrent) return;
      navigate(returnTo, { replace: true });
      useUiStore.getState().openSignIn(returnTo, authErrorFromRedirect(description));
    };
    const error = redirectError();
    if (error !== undefined) {
      fail(error);
      return;
    }
    loadSupabase()
      .then(async (client) => {
        if (!client) return fail(null);
        // getSession waits for the client's start-up, which includes the code exchange.
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError || !data.session) return fail(sessionError?.message ?? null);
        if (isCurrent) navigate(returnTo, { replace: true });
      })
      .catch((e: unknown) => {
        console.error('Sign-in callback failed', e);
        fail(null);
      });
    return () => {
      isCurrent = false;
    };
  }, [navigate]);

  return (
    <main className="grid min-h-dvh place-items-center bg-ink text-paper">
      <p role="status" className="animate-pulse-soft font-semibold">
        Signing you in…
      </p>
    </main>
  );
}
