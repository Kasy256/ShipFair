import { APP_NAME, Handle, type StampCategory } from '@shipfair/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { makerLinks } from '../lib/booth-links.ts';
import { fetchDistricts, fetchPublicPassport } from '../lib/passport-api.ts';
import { socialClient } from '../lib/social-api.ts';
import { AvatarPreviewCanvas } from '../ui/avatar/AvatarPreviewCanvas.tsx';
import { passportPages } from '../ui/passport/passport-pages.ts';
import { StampSlot } from '../ui/passport/StampSlot.tsx';
import { PAGE_TITLES } from '../ui/passport/stamp-info.ts';

const PAGES: readonly StampCategory[] = ['districts', 'booths', 'social'];

/** `/u/:handle`: a maker's public passport (read-only). The Worker injects its OG tags. */
export function ProfilePage() {
  const { handle = '' } = useParams();
  const isValid = Handle.safeParse(handle).success;
  const passport = useQuery({
    queryKey: ['passport', handle],
    queryFn: async () => fetchPublicPassport(await socialClient(), handle),
    enabled: isValid,
  });
  const districtsQuery = useQuery({
    queryKey: ['districts'],
    queryFn: async () => fetchDistricts(await socialClient()),
  });
  const districts = districtsQuery.data ?? [];
  const pages = useMemo(() => passportPages(districtsQuery.data ?? []), [districtsQuery.data]);
  const data = passport.data;
  const held = new Set(data?.stamps.map((s) => s.stamp));

  useEffect(() => {
    document.title = data ? `${data.profile.displayName} (@${handle}) · ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = APP_NAME;
    };
  }, [data, handle]);

  return (
    <main className="min-h-dvh bg-ink px-4 py-10 text-paper">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="font-semibold text-accent">
          ← Walk around {APP_NAME}
        </Link>
        {(passport.isPending || !isValid) && isValid && <p className="mt-6 text-muted">Loading…</p>}
        {(!isValid || (passport.isSuccess && !data)) && (
          <h1 className="mt-6 font-bold text-3xl">Nobody here goes by @{handle}</h1>
        )}
        {passport.isError && (
          <p role="alert" className="mt-6">
            Couldn't load this passport.{' '}
            <button
              type="button"
              className="font-semibold text-accent"
              onClick={() => void passport.refetch()}
            >
              Try again
            </button>
          </p>
        )}
        {data && (
          <>
            <header className="mt-6 flex flex-wrap items-center gap-5">
              <div className="h-48 w-40 overflow-hidden rounded-2xl bg-ink-2">
                <AvatarPreviewCanvas style={data.profile.avatarStyle} />
              </div>
              <div>
                <h1 className="font-bold text-4xl" data-testid="profile-name">
                  {data.profile.displayName}
                </h1>
                <p className="text-muted">@{data.profile.handle}</p>
                <p className="mt-2 font-semibold" data-testid="profile-stamp-count">
                  {data.stamps.length} {data.stamps.length === 1 ? 'stamp' : 'stamps'}
                </p>
                {makerLinks(data.profile.links).length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-x-3 text-sm">
                    {makerLinks(data.profile.links).map((link) => (
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
              </div>
            </header>

            {data.booths.length > 0 && (
              <section aria-labelledby="profile-booths" className="mt-8 rounded-2xl bg-ink-2 p-5">
                <h2 id="profile-booths" className="font-bold text-xl">
                  Booths
                </h2>
                <ul className="mt-3 grid gap-2">
                  {data.booths.map((booth) => (
                    <li key={booth.id}>
                      <Link to={`/b/${booth.slug}`} className="font-semibold text-accent underline">
                        {booth.name}
                      </Link>{' '}
                      <span className="text-muted">— {booth.tagline}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section
              aria-labelledby="profile-passport"
              className="mt-8 rounded-2xl bg-ink-2 p-5"
              data-testid="profile-passport"
            >
              <h2 id="profile-passport" className="font-bold text-xl">
                Passport
              </h2>
              {PAGES.map((page) => (
                <div key={page} className="mt-4">
                  <h3 className="text-muted text-xs uppercase tracking-wider">
                    {PAGE_TITLES[page]}
                  </h3>
                  <ul className="mt-2 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-5">
                    {pages[page].map((stamp) => (
                      <StampSlot
                        key={stamp}
                        stamp={stamp}
                        districts={districts}
                        isHeld={held.has(stamp)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
