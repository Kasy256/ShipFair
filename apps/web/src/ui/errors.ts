import { BoothApiError, type BoothErrorCode } from '../lib/booth-api.ts';
import { ImageError } from '../lib/images.ts';
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

const BOOTH_ERRORS: Record<BoothErrorCode, string> = {
  unauthorized: 'Your session expired. Sign in again; your draft is saved.',
  forbidden: 'That upload link expired. Add the image again.',
  not_found: "We couldn't find that booth. It may have been deleted.",
  bad_request: 'Something in the form needs fixing. Check the highlighted fields.',
  rate_limited: "You're going a bit fast. Wait a few seconds and try again.",
  too_large: 'That image is too big even after resizing. Try a smaller one.',
  turnstile_failed: "The bot check didn't pass. Complete it again, then submit.",
  account_too_new:
    'New accounts have to wait an hour before submitting. Your draft is saved; come back soon.',
  limit_pending:
    'You already have a booth in review. Wait for it to be reviewed, then submit this one.',
  limit_total: 'Makers can have 3 booths for now. Archive one to make room.',
  booth_limit: 'Makers can have 3 booths for now, drafts included. Finish or delete one first.',
  not_submittable: 'This booth is already in review or live, so it was not sent again.',
  logo_missing: 'Add a logo on the Media step, then submit.',
  media_invalid: 'One of the images needs replacing. Go back to the Media step and add it again.',
  upload_invalid: "The upload didn't go through. Add the image again.",
  unavailable: "Submissions aren't available right now. Your draft is saved; try again later.",
  no_permission: "You can't change this booth. If your account was restricted, check your email.",
  network: "We couldn't reach the server. Check your connection and try again.",
};

/**
 * Friendly text for a submission error. The server's own message is shown for image and field
 * problems, because it says exactly what to fix ("Logo must be at least 256×256").
 */
export function boothErrorText(error: unknown): string {
  if (error instanceof ImageError) return error.message;
  if (error instanceof BoothApiError) {
    if (error.code === 'media_invalid' || error.code === 'bad_request') return error.message;
    return BOOTH_ERRORS[error.code];
  }
  return BOOTH_ERRORS.network;
}
