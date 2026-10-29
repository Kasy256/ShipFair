import {
  type AvatarStyleV2,
  DeleteAccountResponse,
  type OwnProfile,
  type ProfileUpdate,
} from '@shipfair/shared';
import { OWN_PROFILE_COLUMNS, OwnProfileFromRow } from './db.ts';
import type { Supabase } from './supabase.ts';

/** Error codes the profile calls raise; `ui/errors.ts` turns them into friendly text. */
export type ProfileErrorCode =
  | 'handle_taken'
  | 'name_not_allowed'
  | 'no_permission'
  | 'not_found'
  | 'handle_mismatch'
  | 'session_expired'
  | 'network';

export class ProfileError extends Error {
  readonly code: ProfileErrorCode;

  constructor(code: ProfileErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProfileError';
    this.code = code;
  }
}

interface PostgrestLikeError {
  code?: string;
  hint?: string | null;
  message: string;
}

/** Postgres error codes from the profiles table and its triggers (ARCHITECTURE.md §5). */
function fromDbError(error: PostgrestLikeError): ProfileError {
  if (error.code === '23505') return new ProfileError('handle_taken', error.message);
  if (error.code === '23514') return new ProfileError('name_not_allowed', error.message);
  if (error.code === '42501') return new ProfileError('no_permission', error.message);
  return new ProfileError('network', error.message, { cause: error });
}

/** The signed-in user's own row (public fields plus `onboarded_at`). */
export async function fetchOwnProfile(client: Supabase, userId: string): Promise<OwnProfile> {
  const { data, error } = await client
    .from('profiles')
    .select(OWN_PROFILE_COLUMNS.join(','))
    .eq('id', userId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new ProfileError('not_found', 'No profile row for this user');
  return OwnProfileFromRow.parse(data);
}

/** Live availability check (`handle_available` RPC: valid, clean, and free in any case). */
export async function isHandleAvailable(client: Supabase, handle: string): Promise<boolean> {
  const { data, error } = await client.rpc('handle_available', { candidate: handle });
  if (error) throw fromDbError(error);
  return data === true;
}

/** Writes handle, display name and links; `finishOnboarding` also stamps `onboarded_at`. */
export async function updateProfile(
  client: Supabase,
  userId: string,
  update: ProfileUpdate,
  extra: { avatarStyle?: AvatarStyleV2; finishOnboarding?: boolean } = {},
): Promise<OwnProfile> {
  const { data, error } = await client
    .from('profiles')
    .update({
      handle: update.handle,
      display_name: update.displayName,
      links: update.links,
      ...(extra.avatarStyle ? { avatar_style: extra.avatarStyle } : {}),
      ...(extra.finishOnboarding ? { onboarded_at: new Date().toISOString() } : {}),
    })
    .eq('id', userId)
    .select(OWN_PROFILE_COLUMNS.join(','))
    .single();
  if (error) throw fromDbError(error);
  return OwnProfileFromRow.parse(data);
}

export async function saveAvatarStyle(
  client: Supabase,
  userId: string,
  style: AvatarStyleV2,
): Promise<void> {
  const { error } = await client.from('profiles').update({ avatar_style: style }).eq('id', userId);
  if (error) throw fromDbError(error);
}

/** `POST /api/me/delete`: the Worker checks the session and the typed handle, then deletes. */
export async function deleteAccount(accessToken: string, handle: string): Promise<number> {
  let res: Response;
  try {
    res = await fetch('/api/me/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ handle }),
    });
  } catch (error) {
    throw new ProfileError('network', 'Could not reach the server', { cause: error });
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) return DeleteAccountResponse.parse(body).queuedMedia;
  if (res.status === 401) throw new ProfileError('session_expired', 'Session expired');
  if (res.status === 400) throw new ProfileError('handle_mismatch', 'Handle does not match');
  if (res.status === 404) throw new ProfileError('not_found', 'Account already gone');
  throw new ProfileError('network', `Delete failed (${res.status})`);
}
