import type { ReportGroup, ReportStatus } from '@shipfair/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { StatusChip } from '../ui/booths/StatusChip.tsx';
import { AdminImage } from './AdminImage.tsx';
import { adminErrorText, hideTarget, setReportStatus } from './admin-api.ts';
import { when } from './admin-format.ts';
import { BanForm } from './BanForm.tsx';

const action = 'rounded-lg bg-ink-3 px-3 py-1.5 font-semibold text-sm disabled:opacity-60';

/** Who the ban button would ban for this target, if anyone. */
function banTarget(group: ReportGroup) {
  return group.booth?.owner ?? group.guestbook?.author ?? group.user ?? null;
}

function Context({ group }: { group: ReportGroup }) {
  if (group.booth) {
    const b = group.booth;
    return (
      <div className="flex gap-3">
        <AdminImage mediaKey={b.logoKey} alt={`${b.name} logo`} className="size-16 rounded-lg" />
        <div>
          <p className="font-bold">
            {b.name} <StatusChip status={b.status} />
          </p>
          <p className="text-sm">{b.tagline}</p>
          <p className="break-all text-muted text-sm">{b.url}</p>
          {b.owner && <UserLink user={b.owner} />}
        </div>
      </div>
    );
  }
  if (group.guestbook) {
    const g = group.guestbook;
    return (
      <div>
        <blockquote className="rounded-lg bg-ink p-3">{g.body}</blockquote>
        <p className="mt-1 text-muted text-sm">
          Guestbook entry{g.hidden ? ' (hidden)' : ''} by{' '}
          {g.author ? <UserLink user={g.author} /> : 'a deleted account'}
        </p>
      </div>
    );
  }
  if (group.user) return <UserLink user={group.user} />;
  if (group.targetType === 'chat') {
    return <p className="text-muted text-sm">Chat report. The attached lines arrive with chat.</p>;
  }
  return <p className="text-muted text-sm">The reported item no longer exists.</p>;
}

function UserLink({ user }: { user: { id: string; handle: string } }) {
  return (
    <Link to={`/admin?tab=users&user=${user.id}`} className="font-semibold text-accent text-sm">
      @{user.handle}
    </Link>
  );
}

/** Open reports about one target, with hide, ban and dismiss (TRUST_AND_SAFETY.md). */
export function ReportCard({ group, onChanged }: { group: ReportGroup; onChanged: () => void }) {
  const [isBanning, setIsBanning] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const banned = banTarget(group);

  const run = async (work: () => Promise<unknown>) => {
    setIsBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setIsBusy(false);
    }
  };
  const closeAll = (status: ReportStatus) =>
    Promise.all(group.reports.map((r) => setReportStatus(r.id, status)));
  const hideAndClose = (hidden: boolean) =>
    run(async () => {
      if (group.booth) await hideTarget({ targetType: 'booth', targetId: group.booth.id, hidden });
      else if (group.guestbook) {
        await hideTarget({ targetType: 'guestbook', targetId: group.guestbook.id, hidden });
      }
      if (hidden) await closeAll('actioned');
    });

  const isHidden = group.booth?.status === 'hidden' || group.guestbook?.hidden === true;
  const canHide = group.booth
    ? group.booth.status === 'approved' || group.booth.status === 'hidden'
    : group.guestbook !== null;

  return (
    <article
      className="grid gap-3 rounded-2xl bg-ink-2 p-5"
      data-testid="report-group"
      data-target-type={group.targetType}
      data-target-id={group.targetId}
    >
      <p className="text-sm">
        <span className="font-bold capitalize">{group.targetType}</span> ·{' '}
        <span data-testid="report-count">{group.openReports} open</span> from {group.reporters}{' '}
        {group.reporters === 1 ? 'person' : 'people'} · since {when(group.firstAt)}
      </p>
      <Context group={group} />
      <ul className="grid gap-1 text-sm">
        {group.reports.map((r) => (
          <li key={r.id}>
            <span className="font-semibold">{r.reason}</span>
            {r.note ? `: ${r.note}` : ''}{' '}
            <span className="text-muted">
              by {r.reporter ? `@${r.reporter.handle}` : 'a deleted account'}, {when(r.createdAt)}
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-red-300 text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canHide && (
          <button
            type="button"
            disabled={isBusy}
            className={action}
            onClick={() => void hideAndClose(!isHidden)}
          >
            {isHidden ? 'Unhide' : 'Hide'}
          </button>
        )}
        {banned && (
          <button
            type="button"
            disabled={isBusy}
            className={action}
            onClick={() => setIsBanning((v) => !v)}
          >
            Ban @{banned.handle}
          </button>
        )}
        <button
          type="button"
          disabled={isBusy}
          className={action}
          onClick={() => void run(() => closeAll('actioned'))}
        >
          Mark handled
        </button>
        <button
          type="button"
          disabled={isBusy}
          className={action}
          onClick={() => void run(() => closeAll('dismissed'))}
        >
          Dismiss
        </button>
      </div>
      {isBanning && banned && (
        <BanForm
          userId={banned.id}
          handle={banned.handle}
          defaultReason={`Reported: ${group.reports.map((r) => r.reason).join(', ')}`}
          onDone={() => void run(() => closeAll('actioned'))}
        />
      )}
    </article>
  );
}
