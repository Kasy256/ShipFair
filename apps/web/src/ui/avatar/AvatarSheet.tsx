import { useState } from 'react';
import { saveAvatarStyle } from '../../lib/profile-api.ts';
import { loadSupabase } from '../../lib/supabase.ts';
import { selectSavedStyle, useSessionStore } from '../../state/session-store.ts';
import { useUiStore } from '../../state/ui-store.ts';
import { authToastText, profileErrorText } from '../errors.ts';
import { Sheet } from '../Sheet.tsx';
import { AvatarEditor } from './AvatarEditor.tsx';

/** Saves the draft look: to the profile when signed in, to this browser for a guest. */
export async function saveLook(): Promise<void> {
  const session = useSessionStore.getState();
  const style = session.draftStyle;
  if (!style) return;
  if (session.profile && session.userId) {
    const client = await loadSupabase();
    if (!client) throw new Error('auth_not_configured');
    await saveAvatarStyle(client, session.userId, style);
    session.setProfile({ ...session.profile, avatarStyle: style });
  } else {
    session.setGuestStyle(style);
  }
  session.setDraftStyle(null);
}

/**
 * The avatar editor over the world, for guests and signed-in users. The world avatar shows the
 * draft while it is open; "Cancel" (or Esc) puts the saved look back.
 */
export function AvatarSheet() {
  const isOpen = useUiStore((s) => s.isAvatarOpen);
  const setAvatarOpen = useUiStore((s) => s.setAvatarOpen);
  const showToast = useUiStore((s) => s.showToast);
  const style = useSessionStore((s) => s.draftStyle ?? selectSavedStyle(s));
  const setDraftStyle = useSessionStore((s) => s.setDraftStyle);
  const isGuest = useSessionStore((s) => s.profile === null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const close = () => {
    setDraftStyle(null);
    setFailure(null);
    setAvatarOpen(false);
  };
  const save = () => {
    setIsSaving(true);
    saveLook().then(
      () => {
        setIsSaving(false);
        setAvatarOpen(false);
        showToast(authToastText('avatar_saved'));
      },
      (error: unknown) => {
        console.error('Saving the look failed', error);
        setIsSaving(false);
        setFailure(profileErrorText(error));
      },
    );
  };

  return (
    <Sheet
      isOpen={isOpen}
      onClose={close}
      labelledBy="avatar-title"
      variant="center"
      testId="avatar-sheet"
    >
      <h2 id="avatar-title" className="font-bold text-2xl">
        Your look
      </h2>
      {isGuest && (
        <p className="mt-1 text-muted text-sm">
          Guests can change their look; it's kept in this browser. Sign in to keep it everywhere.
        </p>
      )}
      <div className="mt-4">
        <AvatarEditor value={style} onChange={setDraftStyle} />
      </div>
      {failure && (
        <p role="alert" className="mt-4 rounded-xl bg-red-950/60 p-3 text-red-100 text-sm">
          {failure}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={isSaving}
          className="rounded-xl bg-accent px-5 py-2.5 font-bold text-ink disabled:opacity-60"
        >
          {isSaving ? 'Saving…' : 'Save look'}
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded-xl bg-ink-3 px-4 py-2.5 font-semibold hover:bg-ink"
        >
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
