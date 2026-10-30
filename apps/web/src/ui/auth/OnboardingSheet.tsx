import type { AvatarStyleV2, OwnProfile } from '@shipfair/shared';
import { type FormEvent, useState } from 'react';
import { updateProfile } from '../../lib/profile-api.ts';
import { loadSupabase } from '../../lib/supabase.ts';
import { selectSavedStyle, useSessionStore } from '../../state/session-store.ts';
import { useUiStore } from '../../state/ui-store.ts';
import { AvatarEditor } from '../avatar/AvatarEditor.tsx';
import { profileErrorText } from '../errors.ts';
import { ProfileFields } from '../profile/ProfileFields.tsx';
import { type DraftErrors, draftFrom, parseDraft } from '../profile/profile-draft.ts';
import { Sheet } from '../Sheet.tsx';

interface OnboardingFormProps {
  profile: OwnProfile;
  onDone: () => void;
}

function OnboardingForm({ profile, onDone }: OnboardingFormProps) {
  const [draft, setDraft] = useState(() => draftFrom(profile, true));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const style = useSessionStore((s) => s.draftStyle ?? selectSavedStyle(s));
  const setDraftStyle = useSessionStore((s) => s.setDraftStyle);
  const setProfile = useSessionStore((s) => s.setProfile);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseDraft(draft);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setIsSaving(true);
    try {
      const client = await loadSupabase();
      if (!client) throw new Error('auth_not_configured');
      const saved = await updateProfile(client, profile.id, parsed.update, {
        avatarStyle: style,
        finishOnboarding: true,
      });
      setProfile(saved);
      setDraftStyle(null);
      onDone();
    } catch (error) {
      console.error('Onboarding save failed', error);
      setFailure(profileErrorText(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2 id="onboarding-title" className="font-bold text-2xl">
        Welcome! Pick your handle
      </h2>
      <p className="mt-1 text-muted">
        Your handle is on your name tag and booth panels. You can change it later on your profile.
      </p>
      <div className="mt-5">
        <ProfileFields draft={draft} errors={errors} onChange={setDraft} />
      </div>
      <h3 className="mt-6 mb-3 font-bold text-lg">Your look</h3>
      <AvatarEditor value={style} onChange={(next: AvatarStyleV2) => setDraftStyle(next)} />
      {failure && (
        <p role="alert" className="mt-4 rounded-xl bg-red-950/60 p-3 text-red-100 text-sm">
          {failure}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-xl bg-accent px-5 py-2.5 font-bold text-ink disabled:opacity-60"
        >
          {isSaving ? 'Saving…' : 'Save and enter the city'}
        </button>
      </div>
    </form>
  );
}

/**
 * First run after the first sign-in: handle (checked live), display name, optional links and the
 * avatar. Changes to the look show on the world avatar while editing. Closing it keeps the
 * generated handle; it opens again on the next sign-in.
 */
export function OnboardingSheet() {
  const isOpen = useUiStore((s) => s.isOnboardingOpen);
  const setOnboardingOpen = useUiStore((s) => s.setOnboardingOpen);
  const profile = useSessionStore((s) => s.profile);
  const setDraftStyle = useSessionStore((s) => s.setDraftStyle);
  const close = () => {
    setDraftStyle(null);
    setOnboardingOpen(false);
  };
  return (
    <Sheet
      isOpen={isOpen && profile !== null}
      onClose={close}
      labelledBy="onboarding-title"
      variant="center"
      testId="onboarding-sheet"
    >
      {profile && <OnboardingForm profile={profile} onDone={() => setOnboardingOpen(false)} />}
    </Sheet>
  );
}
