import { APP_NAME, type OwnProfile } from '@shipfair/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { fetchDistricts, fetchMyBooths } from '../lib/booth-api.ts';
import { loadSupabase } from '../lib/supabase.ts';
import { mediaHost } from '../lib/world-source.ts';
import { useSessionStore } from '../state/session-store.ts';
import { useUiStore } from '../state/ui-store.ts';
import { boothErrorText } from '../ui/errors.ts';
import { emptyForm, formFromBooth, mediaFromBooth } from '../ui/submit/booth-form.ts';
import { SubmitWizard } from '../ui/submit/SubmitWizard.tsx';
import { Toasts } from '../ui/Toasts.tsx';

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** A public (approved) media key on the media host, for thumbnails of a live booth. */
function publicSrc(key: string): string | null {
  if (!mediaHost) return null;
  return `${LOOPBACK.test(mediaHost) ? 'http' : 'https'}://${mediaHost}/${key}`;
}

async function loadForm(userId: string, boothId: string | null) {
  const client = await loadSupabase();
  if (!client) throw new Error('auth_not_configured');
  const [districts, booths] = await Promise.all([
    fetchDistricts(client),
    boothId ? fetchMyBooths(client, userId) : Promise.resolve([]),
  ]);
  return { districts, booth: boothId ? (booths.find((b) => b.id === boothId) ?? null) : null };
}

function Wizard({ profile, boothId }: { profile: OwnProfile; boothId: string | null }) {
  const query = useQuery({
    queryKey: ['submit-form', profile.id, boothId],
    queryFn: () => loadForm(profile.id, boothId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  if (query.isPending) return <p className="mt-4 text-muted">Loading…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="mt-4">
        {boothErrorText(query.error)}{' '}
        <button
          type="button"
          className="font-semibold text-accent"
          onClick={() => void query.refetch()}
        >
          Try again
        </button>
      </p>
    );
  }
  const { districts, booth } = query.data;
  if (boothId && !booth) {
    return <p className="mt-4">We couldn't find that booth. It may have been deleted.</p>;
  }
  if (booth && (booth.status === 'hidden' || booth.status === 'archived')) {
    return <p className="mt-4">This booth is {booth.status} and can't be edited here.</p>;
  }
  const isLive = booth?.status === 'approved';
  return (
    <SubmitWizard
      profile={profile}
      districts={districts}
      booth={booth}
      defaults={booth ? formFromBooth(booth, profile.links) : emptyForm(profile.links)}
      initialMedia={
        booth
          ? mediaFromBooth(booth, (key) => (isLive && !booth.revision ? publicSrc(key) : null))
          : { logo: null, screenshots: [] }
      }
    />
  );
}

/** `/submit` and `/submit?booth=<id>` (edit or resubmit). Sign-in first. */
export function SubmitPage() {
  const status = useSessionStore((s) => s.status);
  const profile = useSessionStore((s) => s.profile);
  const openSignIn = useUiStore((s) => s.openSignIn);
  const [params] = useSearchParams();
  // Read once: the wizard writes the new draft's id into the address without remounting.
  const [boothId] = useState(() => params.get('booth'));

  useEffect(() => {
    document.title = `Claim a booth · ${APP_NAME}`;
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
        <h1 className="mt-6 font-bold text-4xl">{boothId ? 'Edit your booth' : 'Claim a booth'}</h1>
        {status === 'loading' && <p className="mt-4 text-muted">Loading…</p>}
        {status === 'guest' && (
          <div className="mt-4">
            <p>
              Sign in with GitHub or Google to claim a free booth. A person reviews every booth
              before it appears in the city.
            </p>
            <button
              type="button"
              onClick={() => openSignIn(`/submit${boothId ? `?booth=${boothId}` : ''}`)}
              className="mt-4 rounded-xl bg-accent px-4 py-2.5 font-bold text-ink"
            >
              Sign in
            </button>
          </div>
        )}
        {status === 'signed-in' && profile && <Wizard profile={profile} boothId={boothId} />}
        <nav aria-label="Site" className="mt-10 flex gap-4 text-muted text-sm">
          <Link to="/rules">Rules</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </div>
      <Toasts />
    </main>
  );
}
