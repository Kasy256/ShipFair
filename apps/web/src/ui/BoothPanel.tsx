import type { BoothPricing, BoothPublic } from '@shipfair/shared';
import { track } from '../lib/analytics.ts';
import { makerLinks, mediaUrl, shareUrl, tryItUrl } from '../lib/booth-links.ts';
import { useSessionStore } from '../state/session-store.ts';
import { useUiStore } from '../state/ui-store.ts';
import { useWorldStore } from '../state/world-store.ts';
import { ScreenshotCarousel } from './ScreenshotCarousel.tsx';
import { Sheet } from './Sheet.tsx';

const PRICING_LABEL: Record<BoothPricing, string> = {
  free: 'Free',
  freemium: 'Freemium',
  paid: 'Paid',
  'open-source': 'Open source',
};

/** The booth panel: a right-hand panel on wide screens, a bottom sheet on phones. */
export function BoothPanel() {
  const boothId = useUiStore((s) => s.openBoothId);
  const closeBooth = useUiStore((s) => s.closeBooth);
  const booth = useWorldStore((s) => (boothId ? s.boothsById.get(boothId) : undefined));
  return (
    <Sheet
      isOpen={booth !== undefined}
      onClose={closeBooth}
      labelledBy="booth-panel-title"
      variant="side"
      testId="booth-panel"
    >
      {booth && <BoothDetails key={booth.id} booth={booth} onClose={closeBooth} />}
    </Sheet>
  );
}

interface BoothDetailsProps {
  booth: BoothPublic;
  onClose: () => void;
}

// Every booth string is rendered as React text (escaped); nothing here uses innerHTML.
function BoothDetails({ booth, onClose }: BoothDetailsProps) {
  const district = useWorldStore((s) => s.districtsById.get(booth.districtId));
  const maker = useWorldStore((s) => s.makersById.get(booth.ownerId));
  const isGuest = useSessionStore((s) => s.status !== 'signed-in');
  const openSignIn = useUiStore((s) => s.openSignIn);
  const mediaHost = useWorldStore((s) => s.mediaHost);
  const showToast = useUiStore((s) => s.showToast);
  const tryHref = tryItUrl(booth.url);
  const logo = booth.logoKey ? mediaUrl(mediaHost, booth.logoKey) : null;
  const badge =
    'inline-flex items-center gap-1.5 rounded-full bg-ink-3 px-2.5 py-0.5 text-xs font-semibold';

  const copyLink = async () => {
    const link = shareUrl(window.location.origin, booth.slug);
    try {
      await navigator.clipboard.writeText(link);
      showToast('Booth link copied');
    } catch {
      showToast(`Couldn't copy. The link is ${link}`);
    }
  };

  return (
    <article>
      <div className="flex items-start gap-3">
        {logo && (
          <img
            src={logo}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-xl bg-ink-3 object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 id="booth-panel-title" className="font-bold text-2xl leading-tight">
            {booth.name}
          </h2>
          <p className="mt-1 text-muted">{booth.tagline}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mt-1 -mr-1 rounded-lg px-2 py-1 text-2xl leading-none text-muted hover:text-paper"
        >
          <span aria-hidden="true">×</span>
          <span className="sr-only">Close booth panel</span>
        </button>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Booth details">
        {district && (
          <li className={badge}>
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ background: district.color }}
            />
            {district.name}
          </li>
        )}
        {booth.pricing && <li className={badge}>{PRICING_LABEL[booth.pricing]}</li>}
      </ul>

      <ScreenshotCarousel boothName={booth.name} media={booth.media} mediaHost={mediaHost} />

      {booth.description && (
        <p className="mt-4 whitespace-pre-line leading-relaxed">{booth.description}</p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {tryHref && (
          <a
            href={tryHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track({ name: 'booth_try_click', props: { boothId: booth.id } })}
            className="rounded-xl bg-accent px-5 py-2.5 font-bold text-ink"
          >
            Try it<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        <button
          type="button"
          onClick={copyLink}
          className="rounded-xl bg-ink-3 px-4 py-2.5 font-semibold hover:bg-ink"
        >
          Copy booth link
        </button>
      </div>

      {maker && (
        <section aria-labelledby="booth-maker" className="mt-6 rounded-xl bg-ink-3 p-3">
          <h3 id="booth-maker" className="text-muted text-xs uppercase tracking-wider">
            Made by
          </h3>
          <p className="mt-1 font-semibold">
            {maker.displayName} <span className="font-normal text-muted">@{maker.handle}</span>
          </p>
          {makerLinks(maker.links).length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-3 text-sm">
              {makerLinks(maker.links).map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Upvotes and the guestbook arrive in prompt 12; signing in from here returns to this booth. */}
      <section aria-labelledby="booth-social" className="mt-6 border-paper/10 border-t pt-4">
        <h3 id="booth-social" className="sr-only">
          Votes and guestbook
        </h3>
        {isGuest ? (
          <button
            type="button"
            onClick={() => openSignIn(`/b/${booth.slug}`)}
            className="rounded-xl bg-ink-3 px-4 py-2 font-semibold hover:bg-ink"
          >
            ▲ Sign in to vote
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="rounded-xl bg-ink-3 px-4 py-2 font-semibold opacity-60"
          >
            ▲ Voting opens soon
          </button>
        )}
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-muted">Guestbook</span>
          <textarea
            disabled
            rows={2}
            placeholder={isGuest ? 'Sign in to sign the guestbook' : 'The guestbook opens soon'}
            className="w-full resize-none rounded-lg border border-paper/15 bg-transparent px-3 py-2 opacity-60"
          />
        </label>
      </section>
    </article>
  );
}
