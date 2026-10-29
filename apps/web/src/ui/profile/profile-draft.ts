import {
  HandleInput,
  type LinkKind,
  normaliseLinkInput,
  type OwnProfile,
  ProfileUpdate,
} from '@shipfair/shared';
import { useEffect, useState } from 'react';
import { isHandleAvailable } from '../../lib/profile-api.ts';
import { loadSupabase } from '../../lib/supabase.ts';

/** Wait this long after the last keystroke before asking the server about a handle. */
export const HANDLE_CHECK_DEBOUNCE_MS = 350;

export const LINK_KINDS: readonly LinkKind[] = ['reddit', 'x', 'github', 'site'];

/** The form's raw text, before normalising and validation. */
export interface ProfileDraft {
  handle: string;
  displayName: string;
  links: Record<LinkKind, string>;
}

export type DraftErrors = Partial<Record<'handle' | 'displayName' | LinkKind, string>>;

/** The form's starting values. A generated `maker_xxxxxx` handle starts empty during onboarding. */
export function draftFrom(profile: OwnProfile, isOnboarding: boolean): ProfileDraft {
  const links = profile.links;
  return {
    handle: isOnboarding ? '' : profile.handle,
    displayName: profile.displayName,
    links: {
      reddit: links.reddit ?? '',
      x: links.x ?? '',
      github: links.github ?? '',
      site: links.site ?? '',
    },
  };
}

/** Normalises the draft and validates it with the shared schema; errors keyed by field. */
export function parseDraft(
  draft: ProfileDraft,
): { ok: true; update: ProfileUpdate } | { ok: false; errors: DraftErrors } {
  const links = Object.fromEntries(
    LINK_KINDS.flatMap((kind) => {
      const value = normaliseLinkInput(kind, draft.links[kind]);
      return value === undefined ? [] : [[kind, value]];
    }),
  );
  const parsed = ProfileUpdate.safeParse({
    handle: draft.handle.trim().toLowerCase(),
    displayName: draft.displayName,
    links,
  });
  if (parsed.success) return { ok: true, update: parsed.data };
  const errors: DraftErrors = {};
  for (const issue of parsed.error.issues) {
    const key = (issue.path[0] === 'links' ? issue.path[1] : issue.path[0]) as keyof DraftErrors;
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

export type HandleStatus = 'empty' | 'invalid' | 'checking' | 'available' | 'taken' | 'error';

/**
 * Live handle check: format and the name filter locally, then `handle_available` on the server
 * (unique in any case), debounced. The user's current handle counts as available.
 */
export function useHandleCheck(handle: string): { status: HandleStatus; message: string | null } {
  const value = handle.trim().toLowerCase();
  const local = HandleInput.safeParse(value);
  const [remote, setRemote] = useState<{ handle: string; status: HandleStatus } | null>(null);

  useEffect(() => {
    if (!local.success) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      loadSupabase()
        .then((client) => (client ? isHandleAvailable(client, value) : Promise.reject()))
        .then(
          (isFree) =>
            isCurrent && setRemote({ handle: value, status: isFree ? 'available' : 'taken' }),
          () => isCurrent && setRemote({ handle: value, status: 'error' }),
        );
    }, HANDLE_CHECK_DEBOUNCE_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [value, local.success]);

  if (value === '') return { status: 'empty', message: null };
  if (!local.success) return { status: 'invalid', message: local.error.issues[0]?.message ?? null };
  if (remote?.handle !== value) return { status: 'checking', message: 'Checking…' };
  const messages: Record<HandleStatus, string | null> = {
    empty: null,
    invalid: null,
    checking: 'Checking…',
    available: `@${value} is available`,
    taken: `@${value} is taken. Try another.`,
    error: "Couldn't check right now; we'll check again when you save.",
  };
  return { status: remote.status, message: messages[remote.status] };
}
