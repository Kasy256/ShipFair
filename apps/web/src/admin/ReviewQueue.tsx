import type { QueueItem, RejectRequest } from '@shipfair/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminErrorText, approveBooth, fetchQueue, rejectBooth } from './admin-api.ts';
import { queueKeyAction, reviewUrl } from './admin-format.ts';
import { QueueCard } from './QueueCard.tsx';
import { RejectPicker } from './RejectPicker.tsx';

const kbd = 'rounded bg-ink-3 px-1.5 py-0.5 font-mono text-xs';
const button = 'rounded-xl px-4 py-2.5 font-bold disabled:opacity-60';

/**
 * Pending booths and edits, one card at a time. A approves, R opens the reasons, J/K move,
 * O opens the link. A decided card leaves the list and the next one takes its place.
 */
export function ReviewQueue() {
  const query = useInfiniteQuery({
    queryKey: ['admin', 'queue'],
    queryFn: ({ pageParam }) => fetchQueue(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set());
  const [index, setIndex] = useState(0);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<string | null>(null);

  const items = useMemo(
    () => (query.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => !decided.has(i.id)),
    [query.data, decided],
  );
  const at = Math.min(index, Math.max(items.length - 1, 0));
  const current: QueueItem | undefined = items[at];

  // Keep a page ahead, so keyboard reviewing never stalls on a fetch.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && items.length - at <= 3) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length, at]);

  const decide = useCallback(async (item: QueueItem, verb: string, run: () => Promise<unknown>) => {
    setIsBusy(true);
    setError(null);
    try {
      await run();
      setDecided((prev) => new Set(prev).add(item.id));
      setIsRejecting(false);
      setLastDone(`${verb} ${item.name}.`);
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const approve = useCallback(
    (item: QueueItem) => decide(item, 'Approved', () => approveBooth(item.boothId)),
    [decide],
  );
  const reject = (request: RejectRequest) =>
    current && decide(current, 'Rejected', () => rejectBooth(current.boothId, request));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isRejecting || isBusy || !current) return;
      const action = queueKeyAction(e);
      if (!action) return;
      e.preventDefault();
      if (action === 'approve') void approve(current);
      else if (action === 'reject') setIsRejecting(true);
      else if (action === 'next') setIndex(Math.min(at + 1, items.length - 1));
      else if (action === 'prev') setIndex(Math.max(at - 1, 0));
      else window.open(reviewUrl(current), '_blank', 'noopener,noreferrer');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRejecting, isBusy, current, at, items.length, approve]);

  if (query.isPending) return <p className="text-muted">Loading the queue…</p>;
  if (query.isError) {
    return (
      <p role="alert">
        {adminErrorText(query.error)}{' '}
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

  return (
    <section aria-labelledby="queue-title" className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="queue-title" className="font-bold text-xl">
          Review queue{' '}
          <span className="font-normal text-muted" data-testid="queue-count">
            {items.length === 0 ? '' : `${at + 1} of ${items.length}${hasNextPage ? '+' : ''}`}
          </span>
        </h2>
        <p className="text-muted text-sm">
          <kbd className={kbd}>A</kbd> approve · <kbd className={kbd}>R</kbd> reject ·{' '}
          <kbd className={kbd}>J</kbd>/<kbd className={kbd}>K</kbd> next/prev ·{' '}
          <kbd className={kbd}>O</kbd> open link
        </p>
      </div>
      <p aria-live="polite" className="min-h-5 text-emerald-300 text-sm" data-testid="queue-status">
        {lastDone}
      </p>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {current ? (
        <>
          <QueueCard key={current.id} item={current} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void approve(current)}
              className={`${button} bg-emerald-300 text-ink`}
            >
              Approve (A)
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setIsRejecting(true)}
              className={`${button} bg-red-300 text-ink`}
            >
              Reject (R)
            </button>
            <button
              type="button"
              onClick={() => setIndex(Math.max(at - 1, 0))}
              className={`${button} bg-ink-3`}
            >
              Previous (K)
            </button>
            <button
              type="button"
              onClick={() => setIndex(Math.min(at + 1, items.length - 1))}
              className={`${button} bg-ink-3`}
            >
              Next (J)
            </button>
          </div>
        </>
      ) : (
        <p className="rounded-2xl bg-ink-2 p-5" data-testid="queue-empty">
          Nothing waiting for review. Nice.
        </p>
      )}
      <RejectPicker
        key={current?.id ?? 'none'}
        boothName={isRejecting && current ? current.name : null}
        isBusy={isBusy}
        error={error}
        onCancel={() => setIsRejecting(false)}
        onReject={(request) => void reject(request)}
      />
    </section>
  );
}
