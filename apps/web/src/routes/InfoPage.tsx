import { APP_NAME } from '@shipfair/shared';
import { type ReactNode, useEffect } from 'react';
import { Link } from 'react-router';

export type InfoPageId = 'submit' | 'admin' | 'rules' | 'privacy' | 'terms';

// Placeholders until their prompts: /submit (08), /admin (09). /rules carries the
// content rules from TRUST_AND_SAFETY.md; /privacy and /terms are drafts until legal review (16).
const PAGES: Record<InfoPageId, { title: string; body: ReactNode }> = {
  submit: {
    title: 'Claim a booth',
    body: (
      <p>
        Booth submissions open soon. You'll sign in with GitHub or Google, add your project's name,
        tagline, link and screenshots, and a person reviews it before it appears in the city.
      </p>
    ),
  },
  admin: {
    title: 'Admin',
    body: <p>The review queue and moderation tools are coming soon. Staff only.</p>,
  },
  rules: {
    title: 'Rules',
    body: (
      <>
        <p>{APP_NAME} is for makers and the people who like discovering what they build.</p>
        <ul className="mt-4 list-disc space-y-2 pl-5">
          <li>Real products and projects you made or work on.</li>
          <li>No NSFW, gambling, crypto pump schemes, malware, impersonation, or hate.</li>
          <li>Be kind in chat. No harassment, spam or self-promo flooding.</li>
          <li>Every booth is reviewed by a person before it appears. Guests can't chat.</li>
          <li>You must be at least 16 to sign in.</li>
        </ul>
      </>
    ),
  },
  privacy: {
    title: 'Privacy',
    body: (
      <>
        <p>
          We store only what we need. Walking around needs no account and sets no tracking cookies.
          Public profile fields are the ones you choose to fill in.
        </p>
        <p className="mt-3">
          Chat isn't stored, except lines attached to a report, which are kept for 30 days. You can
          delete your account at any time; that removes your profile, booths, votes and guestbook
          entries. This page is a draft and will be completed before launch.
        </p>
      </>
    ),
  },
  terms: {
    title: 'Terms',
    body: (
      <>
        <p>
          By submitting a booth you let {APP_NAME} display its name, text, logo and screenshots in
          the city and in share previews. You must be at least 16 to sign in.
        </p>
        <p className="mt-3">
          To ask for content to be taken down, contact us (the address goes here before launch).
          This page is a draft and will be completed before launch.
        </p>
      </>
    ),
  },
};

interface InfoPageProps {
  page: InfoPageId;
}

/** A plain text page with a way back into the city. */
export function InfoPage({ page }: InfoPageProps) {
  const { title, body } = PAGES[page];

  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);

  return (
    <main className="min-h-dvh bg-ink px-4 py-10 text-paper">
      <article className="mx-auto max-w-2xl">
        <Link to="/" className="font-semibold text-accent">
          ← Back to the city
        </Link>
        <h1 className="mt-6 font-bold text-4xl">{title}</h1>
        <div className="mt-4 leading-relaxed">{body}</div>
        <nav aria-label="Site" className="mt-10 flex gap-4 text-muted text-sm">
          <Link to="/rules">Rules</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </article>
    </main>
  );
}
