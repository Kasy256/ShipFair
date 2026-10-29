import { APP_NAME, type OwnProfile } from '@shipfair/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { updateProfile } from '../lib/profile-api.ts';
import { loadSupabase } from '../lib/supabase.ts';
import { selectSavedStyle, useSessionStore } from '../state/session-store.ts';
import { useUiStore } from '../state/ui-store.ts';
import { signOut } from '../state/use-auth-sync.ts';
import { AvatarEditor } from '../ui/avatar/AvatarEditor.tsx';
import { saveLook } from '../ui/avatar/AvatarSheet.tsx';
import { authToastText, profileErrorText } from '../ui/errors.ts';
import { DeleteAccount } from '../ui/profile/DeleteAccount.tsx';
import { ProfileFields } from '../ui/profile/ProfileFields.tsx';
import { type DraftErrors, draftFrom, parseDraft } from '../ui/profile/profile-draft.ts';
import { Toasts } from '../ui/Toasts.tsx';

const button = 'rounded-xl px-4 py-2.5 font-semibold disabled:opacity-60';
const section = 'mt-8 rounded-2xl bg-ink-2 p-5';

function ProfileSection({ profile }: { profile: OwnProfile }) {
  const [draft, setDraft] = useState(() => draftFrom(profile, false));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const setProfile = useSessionStore((s) => s.setProfile);
  const showToast = useUiStore((s) => s.showToast);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseDraft(draft);
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    setFailure(null);
    setIsSaving(true);
    try {
      const client = await loadSupabase();
      if (!client) throw new Error('auth_not_configured');
      setProfile(await updateProfile(client, profile.id, parsed.update));
      showToast(authToastText('profile_saved'));
    } catch (error) {
      setFailure(profileErrorText(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className={section} aria-labelledby="me-profile">
      <h2 id="me-profile" className="mb-4 font-bold text-xl">
        Profile
      </h2>
      <ProfileFields draft={draft} errors={errors} onChange={setDraft} />
      {failure && (
        <p role="alert" className="mt-3 text-red-300 text-sm">
          {failure}
        </p>
      )}
      <button
        type="submit"
        disabled={isSaving}
        className={`${button} mt-4 bg-accent font-bold text-ink`}
      >
        {isSaving ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}

function AvatarSection() {
  const style = useSessionStore((s) => s.draftStyle ?? selectSavedStyle(s));
  const hasDraft = useSessionStore((s) => s.draftStyle !== null);
  const setDraftStyle = useSessionStore((s) => s.setDraftStyle);
  const showToast = useUiStore((s) => s.showToast);
  const [failure, setFailure] = useState<string | null>(null);

  // Leaving the page drops an unsaved draft.
  useEffect(() => () => setDraftStyle(null), [setDraftStyle]);

  const save = () =>
    saveLook().then(
      () => showToast(authToastText('avatar_saved')),
      (error: unknown) => setFailure(profileErrorText(error)),
    );

  return (
    <section className={section} aria-labelledby="me-avatar">
      <h2 id="me-avatar" className="mb-4 font-bold text-xl">
        Avatar
      </h2>
      <AvatarEditor value={style} onChange={setDraftStyle} />
      {failure && (
        <p role="alert" className="mt-3 text-red-300 text-sm">
          {failure}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!hasDraft}
          onClick={save}
          className={`${button} bg-accent font-bold text-ink`}
        >
          Save look
        </button>
        <button
          type="button"
          disabled={!hasDraft}
          onClick={() => setDraftStyle(null)}
          className={`${button} bg-ink-3`}
        >
          Undo changes
        </button>
      </div>
    </section>
  );
}

/** `/me`: profile, avatar, "My booths" (prompt 08), sign out and delete account. */
export function MePage() {
  const status = useSessionStore((s) => s.status);
  const profile = useSessionStore((s) => s.profile);
  const openSignIn = useUiStore((s) => s.openSignIn);

  useEffect(() => {
    document.title = `Your profile · ${APP_NAME}`;
    return () => {
      document.title = APP_NAME;
    };
  }, []);

  return (
    <main className="min-h-dvh bg-ink px-4 py-10 text-paper">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="font-semibold text-accent">
          ← Back to the city
        </Link>
        <h1 className="mt-6 font-bold text-4xl">Your profile</h1>
        {status === 'loading' && <p className="mt-4 text-muted">Loading…</p>}
        {status === 'guest' && (
          <div className="mt-4">
            <p>Sign in with GitHub or Google to pick a handle, keep your look and claim booths.</p>
            <button
              type="button"
              onClick={() => openSignIn('/me')}
              className={`${button} mt-4 bg-accent font-bold text-ink`}
            >
              Sign in
            </button>
          </div>
        )}
        {status === 'signed-in' && profile && (
          <>
            <p className="mt-2 text-muted" data-testid="me-handle">
              Signed in as @{profile.handle}
            </p>
            <ProfileSection key={profile.handle} profile={profile} />
            <AvatarSection />
            <section className={section} aria-labelledby="me-booths">
              <h2 id="me-booths" className="font-bold text-xl">
                My booths
              </h2>
              <p className="mt-2 text-muted">
                No booths yet. Once you submit one, its review status shows up here.
              </p>
              <Link to="/submit" className="mt-3 inline-block font-semibold text-accent">
                Claim a booth →
              </Link>
            </section>
            <section className={section} aria-labelledby="me-account">
              <h2 id="me-account" className="mb-4 font-bold text-xl">
                Account
              </h2>
              <div className="flex flex-wrap items-start gap-3">
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className={`${button} bg-ink-3`}
                >
                  Sign out
                </button>
                <DeleteAccount handle={profile.handle} />
              </div>
            </section>
          </>
        )}
      </div>
      <Toasts />
    </main>
  );
}
