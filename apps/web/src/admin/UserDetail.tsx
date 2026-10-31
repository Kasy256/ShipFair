import type { AdminReport } from '@shipfair/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StatusChip } from '../ui/booths/StatusChip.tsx';
import { adminErrorText, fetchUser, unbanUser } from './admin-api.ts';
import { ageText, when } from './admin-format.ts';
import { BanForm } from './BanForm.tsx';
import { LogTable } from './LogTable.tsx';

const heading = 'mt-5 mb-2 font-bold';

function Reports({ reports }: { reports: readonly AdminReport[] }) {
  if (reports.length === 0) return <p className="text-muted text-sm">None.</p>;
  return (
    <ul className="grid gap-1 text-sm">
      {reports.map((r) => (
        <li key={r.id}>
          {r.targetType} · <span className="font-semibold">{r.reason}</span>
          {r.note ? `: ${r.note}` : ''} · {r.status} · {when(r.createdAt)}
          {r.reporter ? ` · by @${r.reporter.handle}` : ''}
        </li>
      ))}
    </ul>
  );
}

/** Everything about one account: profile, booths, reports by and against, ban, log. */
export function UserDetail({ userId }: { userId: string }) {
  const query = useQuery({ queryKey: ['admin', 'user', userId], queryFn: () => fetchUser(userId) });
  const [isBanning, setIsBanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (query.isPending) return <p className="text-muted">Loading…</p>;
  if (query.isError) return <p role="alert">{adminErrorText(query.error)}</p>;
  const { user, booths, ban, reportsBy, reportsAgainst, log } = query.data;
  const isStaff = user.role !== 'user';
  const isBanned = ban !== null && (ban.until === null || Date.parse(ban.until) > Date.now());

  const unban = () =>
    unbanUser(user.id).then(
      () => void query.refetch(),
      (e: unknown) => setError(adminErrorText(e)),
    );

  return (
    <article className="rounded-2xl bg-ink-2 p-5" data-testid="user-detail">
      <h3 className="font-bold text-xl">
        @{user.handle} <span className="font-normal text-muted">({user.displayName})</span>
      </h3>
      <p className="text-sm">
        {user.role} · joined {when(user.createdAt)} ({ageText(user.createdAt)} ago)
      </p>
      {isBanned && ban && (
        <p className="mt-2 text-red-300" data-testid="user-banned">
          Banned {ban.until ? `until ${when(ban.until)}` : 'permanently'}: {ban.reason}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-300 text-sm">
          {error}
        </p>
      )}
      {!isStaff && (
        <div className="mt-3 flex gap-2">
          {isBanned ? (
            <button
              type="button"
              onClick={() => void unban()}
              className="rounded-lg bg-ink-3 px-3 py-1.5 font-semibold text-sm"
            >
              Unban
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsBanning((v) => !v)}
              className="rounded-lg bg-ink-3 px-3 py-1.5 font-semibold text-sm"
            >
              Ban…
            </button>
          )}
        </div>
      )}
      {isBanning && !isBanned && (
        <div className="mt-3">
          <BanForm
            userId={user.id}
            handle={user.handle}
            onDone={() => {
              setIsBanning(false);
              void query.refetch();
            }}
          />
        </div>
      )}

      <h4 className={heading}>Booths</h4>
      {booths.length === 0 ? (
        <p className="text-muted text-sm">None.</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {booths.map((b) => (
            <li key={b.id}>
              {b.name} <StatusChip status={b.status} />{' '}
              <span className="text-muted">/{b.slug}</span>
            </li>
          ))}
        </ul>
      )}
      <h4 className={heading}>Reports against them</h4>
      <Reports reports={reportsAgainst} />
      <h4 className={heading}>Reports they made</h4>
      <Reports reports={reportsBy} />
      <h4 className={heading}>Moderation log</h4>
      <LogTable entries={log} />
    </article>
  );
}
