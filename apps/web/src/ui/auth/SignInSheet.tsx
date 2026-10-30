import { APP_NAME } from '@shipfair/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { isAuthConfigured, type OAuthProvider, signInWith } from '../../lib/supabase.ts';
import { useUiStore } from '../../state/ui-store.ts';
import { authErrorText } from '../errors.ts';
import { Sheet } from '../Sheet.tsx';

const PROVIDERS: readonly { id: OAuthProvider; label: string }[] = [
  { id: 'github', label: 'Continue with GitHub' },
  { id: 'google', label: 'Continue with Google' },
];

/**
 * GitHub or Google only (TRUST_AND_SAFETY.md "Accounts"). After the OAuth round trip the user
 * lands back on `signInReturnTo`, e.g. the booth they were looking at.
 */
export function SignInSheet() {
  const isOpen = useUiStore((s) => s.isSignInOpen);
  const returnTo = useUiStore((s) => s.signInReturnTo);
  const authError = useUiStore((s) => s.authError);
  const closeSignIn = useUiStore((s) => s.closeSignIn);
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [hasFailed, setHasFailed] = useState(false);
  const isConfigured = isAuthConfigured();

  const start = (provider: OAuthProvider) => {
    setPending(provider);
    setHasFailed(false);
    // On success the browser leaves for the provider, so only failures come back here.
    signInWith(provider, returnTo).catch((error: unknown) => {
      console.error('Could not start sign-in', error);
      setPending(null);
      setHasFailed(true);
    });
  };

  const error = !isConfigured
    ? authErrorText('auth_not_configured')
    : hasFailed
      ? authErrorText('sign_in_failed')
      : authError
        ? authErrorText(authError)
        : null;

  return (
    <Sheet
      isOpen={isOpen}
      onClose={closeSignIn}
      labelledBy="sign-in-title"
      variant="center"
      testId="sign-in-sheet"
    >
      <h2 id="sign-in-title" className="font-bold text-2xl">
        Sign in to {APP_NAME}
      </h2>
      <p className="mt-2 text-muted">
        Signed-in makers can chat, keep a profile and claim a booth. Walking around stays free
        without an account.
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-950/60 p-3 text-red-100 text-sm">
          {error}
        </p>
      )}
      <div className="mt-5 grid gap-2">
        {PROVIDERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            disabled={!isConfigured || pending !== null}
            onClick={() => start(id)}
            className="rounded-xl bg-paper px-5 py-3 font-bold text-ink hover:bg-white disabled:opacity-50"
          >
            {pending === id ? 'Opening…' : label}
          </button>
        ))}
      </div>
      <p className="mt-5 text-muted text-sm">
        We store your handle, display name, the links you add and your avatar, plus an id from
        GitHub or Google so you can sign in again. You must be 16 or older. Read the{' '}
        <Link to="/privacy" className="text-accent underline">
          privacy notice
        </Link>{' '}
        and{' '}
        <Link to="/terms" className="text-accent underline">
          terms
        </Link>
        .
      </p>
      <button
        type="button"
        onClick={closeSignIn}
        className="mt-4 rounded-xl bg-ink-3 px-4 py-2.5 font-semibold hover:bg-ink"
      >
        Keep exploring as a guest
      </button>
    </Sheet>
  );
}
