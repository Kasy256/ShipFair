import { ProfileError, type ProfileErrorCode } from '../lib/profile-api.ts';
import type { WorldErrorCode } from '../lib/world-source.ts';
import type { AuthErrorCode } from '../state/ui-store.ts';

/** Friendly text for error codes: what went wrong and what to do (CODING_STANDARDS.md §3). */
const WORLD_ERRORS: Record<WorldErrorCode | 'engine', string> = {
  world_unavailable: "The city's booth list isn't loading right now. Try again in a moment.",
  invalid_world:
    'The city data came back damaged. Try again; if it keeps happening, reload the page.',
  network: "We couldn't reach the server. Check your connection and try again.",
  engine:
    "The 3D world couldn't start. Your browser may have WebGL turned off; try another browser or reload the page.",
};

export function worldErrorText(code: WorldErrorCode | 'engine'): string {
  return WORLD_ERRORS[code];
}

const AUTH_ERRORS: Record<AuthErrorCode, string> = {
  account_banned:
    "This account can't sign in to ShipFair because it was banned. If you think that's a mistake, contact us from the Terms page.",
  sign_in_failed: "Sign-in didn't finish. Try again; if it keeps failing, try the other provider.",
  auth_not_configured:
    "Sign-in isn't set up on this server yet. You can keep exploring as a guest.",
};

export function authErrorText(code: AuthErrorCode): string {
  return AUTH_ERRORS[code];
}

/** Sign-in results from the OAuth redirect (`error_description`) mapped to our codes. */
export function authErrorFromRedirect(description: string | null): AuthErrorCode {
  return description?.includes('account_banned') ? 'account_banned' : 'sign_in_failed';
}

const AUTH_TOASTS = {
  session_ended:
    'Your session ended, so you are a guest again. Sign in to pick up where you left off.',
  profile_unavailable:
    "We couldn't load your profile. You're exploring as a guest; try signing in again.",
  signed_out: "You're signed out. Your guest look is back.",
  account_deleted: 'Your account is deleted. Thanks for visiting.',
  avatar_saved: 'Look saved.',
  profile_saved: 'Profile saved.',
} as const;

export function authToastText(key: keyof typeof AUTH_TOASTS): string {
  return AUTH_TOASTS[key];
}

const PROFILE_ERRORS: Record<ProfileErrorCode, string> = {
  handle_taken: 'That handle was just taken. Pick another one.',
  name_not_allowed: 'Name tags are public, so pick a handle and display name without rude words.',
  no_permission: "You can't change that. If your account was restricted, check your email.",
  not_found: 'Your account no longer exists. Sign in again to start over.',
  handle_mismatch: "That isn't your handle. Type it exactly as shown above.",
  session_expired: 'Your session expired. Sign in again, then retry.',
  network: "We couldn't reach the server. Check your connection and try again.",
};

export function profileErrorText(error: unknown): string {
  return error instanceof ProfileError ? PROFILE_ERRORS[error.code] : PROFILE_ERRORS.network;
}
