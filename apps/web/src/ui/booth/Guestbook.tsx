import {
  GUESTBOOK_MAX_CHARS,
  type GuestbookEntryPublic,
  type ReportReason,
} from '@shipfair/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import {
  fetchGuestbook,
  hideGuestbookEntry,
  postGuestbook,
  socialClient,
  submitReport,
} from '../../lib/social-api.ts';
import { useSessionStore } from '../../state/session-store.ts';
import { useUiStore } from '../../state/ui-store.ts';
import { earnStamp } from '../../state/use-passport.ts';
import { socialErrorText } from '../errors.ts';
import { ReportForm } from '../social/ReportForm.tsx';

const when = (iso: string) =>
  new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A booth's guestbook (prompt 12): newest first, 20 at a time, and a composer for signed-in
 * visitors. The database censors each entry (trigger `guestbook_entries_filter`) and limits it to
 * 5 per user per 10 minutes. The booth's owner can hide entries; anyone signed in can report one.
 */
export function Guestbook({
  boothId,
  ownerId,
  slug,
}: {
  boothId: string;
  ownerId: string;
  slug: string;
}) {
  const userId = useSessionStore((s) => s.userId);
  const openSignIn = useUiStore((s) => s.openSignIn);
  const queryClient = useQueryClient();
  const key = ['guestbook', boothId] as const;
  const entries = useInfiniteQuery({
    queryKey: key,
    queryFn: async ({ pageParam }) => fetchGuestbook(await socialClient(), boothId, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.nextBefore,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const list = entries.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <section aria-labelledby="guestbook-title" className="mt-6">
      <h3 id="guestbook-title" className="font-bold">
        Guestbook
      </h3>
      {userId ? (
        <Composer boothId={boothId} userId={userId} onPosted={refresh} />
      ) : (
        <button
          type="button"
          onClick={() => openSignIn(`/b/${slug}`)}
          className="mt-2 rounded-xl bg-ink-3 px-4 py-2 font-semibold hover:bg-ink"
        >
          Sign in to sign the guestbook
        </button>
      )}
      {entries.isError && (
        <p role="alert" className="mt-2 text-red-300 text-sm">
          {socialErrorText(entries.error)}
        </p>
      )}
      {entries.isSuccess && list.length === 0 && (
        <p className="mt-3 text-muted text-sm">No entries yet. Be the first to say hi.</p>
      )}
      <ol className="mt-3 grid gap-2" data-testid="guestbook-list">
        {list.map((entry) => (
          <Entry
            key={entry.id}
            entry={entry}
            canHide={userId === ownerId}
            canReport={userId !== null && userId !== entry.authorId}
            reporterId={userId}
            onChanged={refresh}
          />
        ))}
      </ol>
      {entries.hasNextPage && (
        <button
          type="button"
          disabled={entries.isFetchingNextPage}
          onClick={() => void entries.fetchNextPage()}
          className="mt-2 font-semibold text-accent text-sm disabled:opacity-60"
        >
          Show older entries
        </button>
      )}
    </section>
  );
}

function Composer({
  boothId,
  userId,
  onPosted,
}: {
  boothId: string;
  userId: string;
  onPosted: () => void;
}) {
  const id = useId();
  const [body, setBody] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = Array.from(body).length;

  const post = async (e: FormEvent) => {
    e.preventDefault();
    if (body.trim() === '') return;
    setIsBusy(true);
    setError(null);
    try {
      await postGuestbook(await socialClient(), userId, { boothId, body });
      setBody('');
      earnStamp('first:note');
      onPosted();
    } catch (failure) {
      setError(socialErrorText(failure));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void post(e)} className="mt-2 grid gap-1">
      <label htmlFor={`${id}-body`} className="sr-only">
        Guestbook entry
      </label>
      <textarea
        id={`${id}-body`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={GUESTBOOK_MAX_CHARS}
        rows={2}
        placeholder="Leave a note for the maker"
        aria-describedby={`${id}-count`}
        className="w-full resize-none rounded-lg border border-paper/15 bg-transparent px-3 py-2"
        data-testid="guestbook-input"
      />
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-count`} className="text-muted text-xs tabular-nums">
          {length}/{GUESTBOOK_MAX_CHARS}
        </span>
        <button
          type="submit"
          disabled={isBusy || body.trim() === ''}
          className="rounded-lg bg-accent px-3 py-1.5 font-bold text-ink text-sm disabled:opacity-60"
          data-testid="guestbook-post"
        >
          Sign guestbook
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-300 text-sm">
          {error}
        </p>
      )}
    </form>
  );
}

function Entry({
  entry,
  canHide,
  canReport,
  reporterId,
  onChanged,
}: {
  entry: GuestbookEntryPublic;
  canHide: boolean;
  canReport: boolean;
  reporterId: string | null;
  onChanged: () => void;
}) {
  const showToast = useUiStore((s) => s.showToast);
  const [isReporting, setIsReporting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const hide = async () => {
    setIsBusy(true);
    try {
      await hideGuestbookEntry(await socialClient(), entry.id);
      showToast('Entry hidden.');
      onChanged();
    } catch (failure) {
      showToast(socialErrorText(failure));
    } finally {
      setIsBusy(false);
    }
  };
  const report = async (reason: ReportReason, note: string) => {
    if (!reporterId) return;
    await submitReport(await socialClient(), reporterId, {
      targetType: 'guestbook',
      targetId: String(entry.id),
      reason,
      ...(note ? { note } : {}),
    });
  };

  return (
    <li className="rounded-xl bg-ink-3 p-3 text-sm" data-testid="guestbook-entry">
      <p className="whitespace-pre-line break-words" data-testid="guestbook-body">
        {entry.body}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-muted text-xs">
        <span>
          {entry.authorName} @{entry.authorHandle} · {when(entry.createdAt)}
        </span>
        {canHide && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void hide()}
            className="font-semibold text-paper hover:underline disabled:opacity-60"
            data-testid="guestbook-hide"
          >
            Hide
          </button>
        )}
        {canReport && (
          <button
            type="button"
            onClick={() => setIsReporting((v) => !v)}
            aria-expanded={isReporting}
            className="font-semibold text-paper hover:underline"
          >
            Report
          </button>
        )}
      </p>
      {isReporting && (
        <ReportForm what="this entry" submit={report} onClose={() => setIsReporting(false)} />
      )}
    </li>
  );
}
