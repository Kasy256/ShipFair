import { useInfiniteQuery } from '@tanstack/react-query';
import { adminErrorText, fetchReports } from './admin-api.ts';
import { ReportCard } from './ReportCard.tsx';

/** Open reports grouped by target, most reported first (prompt 09 §4). */
export function ReportsInbox() {
  const query = useInfiniteQuery({
    queryKey: ['admin', 'reports'],
    queryFn: ({ pageParam }) => fetchReports(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const groups = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby="reports-title" className="grid gap-4">
      <h2 id="reports-title" className="font-bold text-xl">
        Reports
      </h2>
      {query.isPending && <p className="text-muted">Loading reports…</p>}
      {query.isError && <p role="alert">{adminErrorText(query.error)}</p>}
      {query.isSuccess && groups.length === 0 && (
        <p className="rounded-2xl bg-ink-2 p-5">No open reports.</p>
      )}
      {groups.map((group) => (
        <ReportCard
          key={`${group.targetType}:${group.targetId}`}
          group={group}
          onChanged={() => void query.refetch()}
        />
      ))}
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
