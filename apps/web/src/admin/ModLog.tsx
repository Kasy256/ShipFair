import type { LogFilter } from '@shipfair/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { adminErrorText, fetchLog } from './admin-api.ts';
import { LogTable } from './LogTable.tsx';

const ACTIONS = [
  'approve',
  'reject',
  'approve_revision',
  'reject_revision',
  'hide',
  'unhide',
  'ban',
  'unban',
  'report_status',
  'set_flag',
  'auto_hide',
  'prescreen',
];
const TARGET_TYPES = ['booth', 'booth_revision', 'guestbook', 'user', 'report', 'flag'];
const field = 'rounded-lg bg-ink p-2';

/** The moderation log with filters (prompt 09 §6). */
export function ModLog() {
  const [draft, setDraft] = useState({ action: '', targetType: '', targetId: '' });
  const [filter, setFilter] = useState<LogFilter>({});
  const query = useInfiniteQuery({
    queryKey: ['admin', 'log', filter],
    queryFn: ({ pageParam }) => fetchLog(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setFilter({
      ...(draft.action ? { action: draft.action } : {}),
      ...(draft.targetType ? { targetType: draft.targetType } : {}),
      ...(draft.targetId.trim() ? { targetId: draft.targetId.trim() } : {}),
    });
  };

  return (
    <section aria-labelledby="log-title" className="grid gap-4">
      <h2 id="log-title" className="font-bold text-xl">
        Moderation log
      </h2>
      <form onSubmit={apply} className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          Action
          <select
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            className={field}
          >
            <option value="">Any</option>
            {ACTIONS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Target type
          <select
            value={draft.targetType}
            onChange={(e) => setDraft({ ...draft, targetType: e.target.value })}
            className={field}
          >
            <option value="">Any</option>
            {TARGET_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Target id
          <input
            value={draft.targetId}
            onChange={(e) => setDraft({ ...draft, targetId: e.target.value })}
            className={field}
          />
        </label>
        <button type="submit" className="rounded-xl bg-accent px-4 py-2 font-bold text-ink">
          Filter
        </button>
      </form>
      {query.isPending && <p className="text-muted">Loading the log…</p>}
      {query.isError && <p role="alert">{adminErrorText(query.error)}</p>}
      {query.data && <LogTable entries={query.data.pages.flatMap((p) => p.items)} />}
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          className="justify-self-start rounded-xl bg-ink-3 px-4 py-2 font-semibold"
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
