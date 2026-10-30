import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { loadSupabase } from '../lib/supabase.ts';
import { useAuthSync } from '../state/use-auth-sync.ts';
import { OnboardingSheet } from '../ui/auth/OnboardingSheet.tsx';
import { SignInSheet } from '../ui/auth/SignInSheet.tsx';

/**
 * E2E only: signs in with the local email + password provider, which exists in local Supabase
 * and nowhere else (OAuth isn't exercised in e2e). Vite drops it from production builds.
 */
function installTestAuth(): () => void {
  window.__shipfairAuth = {
    async signInWithPassword(email, password) {
      const client = await loadSupabase();
      if (!client) return 'auth_not_configured';
      const { error } = await client.auth.signInWithPassword({ email, password });
      return error?.message ?? null;
    },
  };
  return () => {
    delete window.__shipfairAuth;
  };
}

/** Every route: keeps the session in step with Supabase and hosts sign-in and onboarding. */
export function RootLayout() {
  useAuthSync();
  useEffect(() => (import.meta.env.MODE !== 'production' ? installTestAuth() : undefined), []);
  return (
    <>
      <Outlet />
      <SignInSheet />
      <OnboardingSheet />
    </>
  );
}
