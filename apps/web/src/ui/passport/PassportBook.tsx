import type { StampCategory, StampKey } from '@shipfair/shared';
import { useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { usePassportStore } from '../../state/passport-store.ts';
import { useSession } from '../../state/session-store.ts';
import { useUiStore } from '../../state/ui-store.ts';
import { useWorldStore } from '../../state/world-store.ts';
import { Sheet } from '../Sheet.tsx';
import { passportPages } from './passport-pages.ts';
import { StampSlot } from './StampSlot.tsx';
import { canvasBlob, drawPassportCard, sharePassport } from './share-card.ts';
import { PAGE_TITLES, stampInfo } from './stamp-info.ts';

const PAGES: readonly StampCategory[] = ['districts', 'booths', 'social'];
/** New stamps thump in one after another. */
const STAMP_STAGGER_MS = 180;

/** The passport book (P, or the HUD's Passport button): a page per kind of stamp. */
export function PassportBook() {
  const isOpen = useUiStore((s) => s.isPassportOpen);
  const setOpen = useUiStore((s) => s.setPassportOpen);
  const markSeen = usePassportStore((s) => s.markSeen);
  const close = () => {
    setOpen(false);
    markSeen();
  };
  return (
    <Sheet
      isOpen={isOpen}
      onClose={close}
      labelledBy="passport-title"
      variant="center"
      testId="passport-book"
    >
      {isOpen && <PassportPages onClose={close} />}
    </Sheet>
  );
}

function PassportPages({ onClose }: { onClose: () => void }) {
  const stamps = usePassportStore((s) => s.stamps);
  const opened = usePassportStore((s) => s.opened.length);
  // Captured on open: stamps earned while the book is open don't re-animate the page.
  const [fresh] = useState(() => new Set(usePassportStore.getState().fresh));
  const districtsById = useWorldStore((s) => s.districtsById);
  const districts = useMemo(() => [...districtsById.values()], [districtsById]);
  const isReducedMotion = useUiStore((s) => s.isReducedMotion);
  const openSignIn = useUiStore((s) => s.openSignIn);
  const showToast = useUiStore((s) => s.showToast);
  const session = useSession();
  const location = useLocation();
  const pages = useMemo(() => passportPages(districts), [districts]);
  const firstFresh = PAGES.find((p) => pages[p].some((s) => fresh.has(s))) ?? 'districts';
  const [page, setPage] = useState<StampCategory>(firstFresh);
  const total = PAGES.reduce((n, p) => n + pages[p].length, 0);
  const held = PAGES.reduce((n, p) => n + pages[p].filter((s) => stamps.has(s)).length, 0);
  const handle = session.profile?.handle ?? null;

  const share = async () => {
    const canvas = document.createElement('canvas');
    drawPassportCard(canvas, {
      title: handle ? `@${handle}'s passport` : 'My passport',
      subtitle: `${held} of ${total} stamps collected`,
      slots: PAGES.flatMap((p) =>
        pages[p].map((s) => ({ info: stampInfo(s, districts), held: stamps.has(s) })),
      ),
      footer: handle ? `${window.location.host}/u/${handle}` : window.location.host,
    });
    const link = handle ? `${window.location.origin}/u/${handle}` : null;
    try {
      const outcome = await sharePassport(await canvasBlob(canvas), link);
      if (outcome === 'copied') showToast('Passport link copied');
      if (outcome === 'downloaded') showToast('Passport image saved');
    } catch (error) {
      console.warn('Passport share failed', error);
      showToast("Couldn't share the passport. Try again.");
    }
  };

  let freshIndex = 0;
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="passport-title" className="font-bold text-2xl">
            Passport
          </h2>
          <p className="text-muted text-sm" data-testid="passport-count">
            {held} of {total} stamps · {opened} {opened === 1 ? 'booth' : 'booths'} opened
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mt-1 -mr-1 rounded-lg px-2 py-1 text-2xl text-muted leading-none hover:text-paper"
        >
          <span aria-hidden="true">×</span>
          <span className="sr-only">Close passport</span>
        </button>
      </div>

      <div role="tablist" aria-label="Passport pages" className="mt-4 flex gap-2">
        {PAGES.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            id={`passport-tab-${p}`}
            aria-selected={page === p}
            aria-controls="passport-page"
            onClick={() => setPage(p)}
            className={`rounded-lg px-3 py-1.5 font-semibold text-sm ${page === p ? 'bg-accent text-ink' : 'bg-ink-3 hover:bg-ink'}`}
          >
            {PAGE_TITLES[p]}{' '}
            <span className="tabular-nums opacity-75">
              {pages[p].filter((s) => stamps.has(s)).length}/{pages[p].length}
            </span>
          </button>
        ))}
      </div>

      <section
        id="passport-page"
        role="tabpanel"
        aria-labelledby={`passport-tab-${page}`}
        className="mt-4 rounded-xl bg-[#f5f3ee0d] p-4"
      >
        <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4">
          {pages[page].map((stamp: StampKey) => {
            const heldStamp = stamps.get(stamp);
            const isFresh = !isReducedMotion && fresh.has(stamp) && heldStamp !== undefined;
            return (
              <StampSlot
                key={stamp}
                stamp={stamp}
                districts={districts}
                isHeld={heldStamp !== undefined}
                isPending={heldStamp?.isPending ?? false}
                isFresh={isFresh}
                delayMs={isFresh ? STAMP_STAGGER_MS * freshIndex++ : 0}
              />
            );
          })}
        </ul>
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={share}
          disabled={held === 0}
          className="rounded-xl bg-accent px-4 py-2.5 font-bold text-ink disabled:opacity-50"
          data-testid="passport-share"
        >
          Share my passport
        </button>
        {session.isGuest && (
          <button
            type="button"
            onClick={() => openSignIn(location.pathname)}
            className="rounded-xl bg-ink-3 px-4 py-2.5 font-semibold hover:bg-ink"
          >
            Sign in to keep your stamps
          </button>
        )}
      </div>
    </div>
  );
}
