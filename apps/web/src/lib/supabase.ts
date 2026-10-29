import { type Database, WebBuildEnv } from '@shipfair/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Supabase = SupabaseClient<Database>;
export type OAuthProvider = 'github' | 'google';

const SupabaseEnv = WebBuildEnv.pick({ VITE_SUPABASE_URL: true, VITE_SUPABASE_ANON_KEY: true });
const RETURN_TO_KEY = 'shipfair:return-to';
/** Where OAuth lands (allowed by `additional_redirect_urls` / the dashboard's redirect URLs). */
export const AUTH_CALLBACK_PATH = '/auth/callback';

/** True when this build has Supabase settings. Without them the app runs guest-only. */
export function isAuthConfigured(): boolean {
  return SupabaseEnv.safeParse(import.meta.env).success;
}

let pending: Promise<Supabase | null> | undefined;

/**
 * The one browser client: PKCE flow, session persisted in localStorage and refreshed by
 * supabase-js. Imported on demand (supabase-js is ~50 kB gzipped) so the loading screen paints
 * first. Resolves null when the build has no Supabase settings. OAuth tokens never pass
 * through our code: only the Supabase session is kept.
 */
export function loadSupabase(): Promise<Supabase | null> {
  pending ??= (async () => {
    const env = SupabaseEnv.safeParse(import.meta.env);
    if (!env.success) return null;
    const { createClient } = await import('@supabase/supabase-js');
    return createClient<Database>(env.data.VITE_SUPABASE_URL, env.data.VITE_SUPABASE_ANON_KEY, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  })().catch((error: unknown) => {
    pending = undefined; // a failed chunk download can be retried
    throw error;
  });
  return pending;
}

/** Only same-site paths, never `//host` or a scheme, so the return path can't leave the site. */
export function safeReturnPath(path: string | null | undefined): string {
  if (!path?.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/';
  return path.startsWith(AUTH_CALLBACK_PATH) ? '/' : path;
}

/** Remembers where to come back to after the OAuth round trip (session storage, this tab only). */
export function rememberReturnPath(path: string): void {
  try {
    sessionStorage.setItem(RETURN_TO_KEY, safeReturnPath(path));
  } catch (error) {
    console.warn('Could not keep the return path; sign-in will land on the plaza', error);
  }
}

/** The remembered return path (once: it is cleared as it is read). */
export function takeReturnPath(): string {
  try {
    const path = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return safeReturnPath(path);
  } catch {
    return '/';
  }
}

/** Starts the OAuth redirect. `returnTo` is where the user lands afterwards (e.g. `/b/slug`). */
export async function signInWith(provider: OAuthProvider, returnTo: string): Promise<void> {
  const client = await loadSupabase();
  if (!client) throw new Error('auth_not_configured');
  rememberReturnPath(returnTo);
  const { error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}` },
  });
  if (error) throw error;
}
