import { BOOTHS_PER_USER_MAX, type BoothOwn } from '@shipfair/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchMyBooths } from '../../lib/booth-api.ts';
import { loadSupabase } from '../../lib/supabase.ts';
import { useUiStore } from '../../state/ui-store.ts';
import { boothErrorText } from '../errors.ts';
import { StatusChip } from './StatusChip.tsx';

const action = 'rounded-lg bg-ink-3 px-3 py-1.5 font-semibold text-sm hover:bg-ink';

async function load(userId: string): Promise<BoothOwn[]> {
  const client = await loadSupabase();
  if (!client) throw new Error('auth_not_configured');
  return fetchMyBooths(client, userId);
}

function RevisionLine({ booth }: { booth: BoothOwn }) {
  const revision = booth.revision;
  if (!revision || revision.status === 'approved') return null;
  return revision.status === 'pending' ? (
    <p className="mt-1 text-sm text-amber-300">Your latest edit is in review.</p>
  ) : (
    <p className="mt-1 text-red-300 text-sm">
      Your latest edit needs changes{revision.rejectReason ? `: ${revision.rejectReason}` : '.'}
    </p>
  );
}

function BoothRow({ booth }: { booth: BoothOwn }) {
  const showToast = useUiStore((s) => s.showToast);
  const shareUrl = `${window.location.origin}/b/${booth.slug}`;
  const copy = () =>
    navigator.clipboard.writeText(shareUrl).then(
      () => showToast('Link copied.'),
      () => showToast(`Copy this link: ${shareUrl}`),
    );
  const isLive = booth.status === 'approved';
  const canEdit = booth.status !== 'hidden' && booth.status !== 'archived';
  return (
    <li className="rounded-xl bg-ink p-4" data-testid="my-booth" data-booth-id={booth.id}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">{booth.name}</h3>
        <StatusChip status={booth.status} />
      </div>
      <p className="mt-1 text-muted text-sm">{booth.tagline}</p>
      {booth.status === 'rejected' && (
        <p className="mt-1 text-red-300 text-sm" data-testid="reject-reason">
          Changes needed{booth.rejectReason ? `: ${booth.rejectReason}` : '.'} Edit it and submit
          again.
        </p>
      )}
      {booth.status === 'hidden' && (
        <p className="mt-1 text-sm">Hidden after reports while a moderator takes a look.</p>
      )}
      <RevisionLine booth={booth} />
      <div className="mt-3 flex flex-wrap gap-2">
        {canEdit && (
          <Link to={`/submit?booth=${booth.id}`} className={action} data-testid="edit-booth">
            {booth.status === 'rejected' ? 'Edit and resubmit' : 'Edit'}
          </Link>
        )}
        {isLive && (
          <>
            <Link to={`/b/${booth.slug}`} className={action}>
              View in city
            </Link>
            <button type="button" className={action} onClick={() => void copy()}>
              Copy link
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/** `/me` "My booths": status chips, reasons, edit/resubmit, view and share (prompt 08). */
export function MyBooths({ userId }: { userId: string }) {
  const query = useQuery({ queryKey: ['my-booths', userId], queryFn: () => load(userId) });
  const booths = query.data ?? [];
  return (
    <>
      {query.isPending && <p className="mt-2 text-muted">Loading…</p>}
      {query.isError && (
        <p role="alert" className="mt-2">
          {boothErrorText(query.error)}{' '}
          <button
            type="button"
            className="font-semibold text-accent"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </p>
      )}
      {query.isSuccess && booths.length === 0 && (
        <p className="mt-2 text-muted">
          No booths yet. Once you submit one, its review status shows up here.
        </p>
      )}
      {booths.length > 0 && (
        <ul className="mt-3 grid gap-3" data-testid="my-booths">
          {booths.map((booth) => (
            <BoothRow key={booth.id} booth={booth} />
          ))}
        </ul>
      )}
      {query.isSuccess && booths.length < BOOTHS_PER_USER_MAX && (
        <Link to="/submit" className="mt-3 inline-block font-semibold text-accent">
          Claim a booth →
        </Link>
      )}
    </>
  );
}
