import { Link } from 'react-router';
import { useSession } from '../state/session-store.ts';
import { useUiStore } from '../state/ui-store.ts';
import { Sheet } from './Sheet.tsx';

/**
 * Opened by the plaza kiosk (`ui:open-submit`). It asks first instead of leaving the city. Guests
 * sign in first and land on /submit afterwards.
 */
export function ClaimSheet() {
  const isOpen = useUiStore((s) => s.isClaimOpen);
  const setClaimOpen = useUiStore((s) => s.setClaimOpen);
  const openSignIn = useUiStore((s) => s.openSignIn);
  const session = useSession();
  const primary = 'rounded-xl bg-accent px-5 py-2.5 font-bold text-ink';
  return (
    <Sheet
      isOpen={isOpen}
      onClose={() => setClaimOpen(false)}
      labelledBy="claim-title"
      variant="center"
    >
      <h2 id="claim-title" className="font-bold text-2xl">
        Claim a booth
      </h2>
      <p className="mt-2 text-muted">
        Built something? Every approved project gets a free booth in the city. A person reviews each
        one before it goes up.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {session.status === 'signed-in' ? (
          <Link to="/submit" className={primary}>
            Go to the submission form
          </Link>
        ) : (
          <button
            type="button"
            className={primary}
            disabled={session.status === 'loading'}
            onClick={() => openSignIn('/submit')}
          >
            Sign in to claim a booth
          </button>
        )}
        <button
          type="button"
          onClick={() => setClaimOpen(false)}
          className="rounded-xl bg-ink-3 px-4 py-2.5 font-semibold hover:bg-ink"
        >
          Keep exploring
        </button>
      </div>
    </Sheet>
  );
}
