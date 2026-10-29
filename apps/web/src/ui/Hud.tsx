import { APP_NAME } from '@shipfair/shared';
import { Link, useLocation } from 'react-router';
import { useSession } from '../state/session-store.ts';
import { useUiStore } from '../state/ui-store.ts';
import { useWorldStore } from '../state/world-store.ts';
import { zoneName } from './districts.ts';

/**
 * Top-left: brand, the current district and the live visitor count (a placeholder until the
 * realtime client lands in prompt 11). Top-right: the visitor (sign in, or the handle linking to
 * /me), the avatar editor, map and help.
 */
export function Hud() {
  const zone = useWorldStore((s) => zoneName(s.currentDistrictId, s.districtsById));
  const setMapOpen = useUiStore((s) => s.setMapOpen);
  const setHelpOpen = useUiStore((s) => s.setHelpOpen);
  const isHelpOpen = useUiStore((s) => s.isHelpOpen);
  const openSignIn = useUiStore((s) => s.openSignIn);
  const setAvatarOpen = useUiStore((s) => s.setAvatarOpen);
  const session = useSession();
  const location = useLocation();
  const button =
    'pointer-events-auto rounded-lg bg-ink/75 px-3 py-1.5 font-semibold text-sm backdrop-blur hover:bg-ink';

  return (
    <>
      <header className="pointer-events-none absolute top-3 left-3 z-10 rounded-xl bg-ink/70 px-3 py-2 backdrop-blur">
        <h1 className="font-bold text-accent text-lg leading-none tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 font-semibold text-sm" data-testid="hud-district">
          {zone}
        </p>
        <p className="text-muted text-xs">
          <span
            aria-hidden="true"
            className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400"
          />
          <span title="Live visitor counts arrive with multiplayer">— online</span>
        </p>
        {session.isGuest && session.status !== 'loading' && (
          <p className="text-muted text-xs" data-testid="hud-name">
            You're {session.name}
          </p>
        )}
      </header>
      <nav
        aria-label="World"
        className="absolute top-3 right-3 z-10 flex max-w-[60vw] flex-wrap justify-end gap-2"
      >
        {session.status === 'signed-in' && session.profile ? (
          <Link to="/me" className={button} data-testid="hud-account">
            @{session.profile.handle}
          </Link>
        ) : (
          <button
            type="button"
            className={button}
            data-testid="hud-account"
            disabled={session.status === 'loading'}
            onClick={() => openSignIn(location.pathname)}
          >
            Sign in
          </button>
        )}
        <button type="button" className={button} onClick={() => setAvatarOpen(true)}>
          Avatar
        </button>
        <button type="button" className={button} onClick={() => setMapOpen(true)}>
          Map <kbd className="ml-1 text-muted text-xs">M</kbd>
        </button>
        <button
          type="button"
          className={button}
          aria-expanded={isHelpOpen}
          aria-controls="controls-help"
          onClick={() => setHelpOpen(!isHelpOpen)}
        >
          Help <kbd className="ml-1 text-muted text-xs">?</kbd>
        </button>
      </nav>
    </>
  );
}
