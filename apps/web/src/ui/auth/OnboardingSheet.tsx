import { lazy, Suspense } from 'react';
import { useSessionStore } from '../../state/session-store.ts';
import { useUiStore } from '../../state/ui-store.ts';
import { Sheet } from '../Sheet.tsx';

// The form embeds the avatar editor; it is its own chunk, loaded when the sheet first opens.
const OnboardingForm = lazy(() =>
  import('./OnboardingForm.tsx').then((m) => ({ default: m.OnboardingForm })),
);

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
      <Suspense fallback={<p className="py-10 text-center text-muted">Loading…</p>}>
        {profile && <OnboardingForm profile={profile} onDone={() => setOnboardingOpen(false)} />}
      </Suspense>
    </Sheet>
  );
}
