import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchVotes, setVote, socialClient, type VoteState } from '../../lib/social-api.ts';
import { engineBus } from '../../state/engine-bus.ts';
import { useSessionStore } from '../../state/session-store.ts';
import { useUiStore } from '../../state/ui-store.ts';
import { socialErrorText } from '../errors.ts';

/**
 * The booth's heart (prompt 12): the count from `booth_vote_counts`, one vote per user per booth,
 * updated optimistically. Upvoting bursts hearts at the booth in the world.
 */
export function VoteButton({ boothId, slug }: { boothId: string; slug: string }) {
  const userId = useSessionStore((s) => s.userId);
  const openSignIn = useUiStore((s) => s.openSignIn);
  const showToast = useUiStore((s) => s.showToast);
  const queryClient = useQueryClient();
  const key = ['votes', boothId, userId] as const;
  const votes = useQuery({
    queryKey: key,
    queryFn: async () => fetchVotes(await socialClient(), boothId, userId),
  });
  const mutation = useMutation({
    mutationFn: async (isVoted: boolean) => {
      if (!userId) return;
      await setVote(await socialClient(), boothId, userId, isVoted);
    },
    onMutate: async (isVoted) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<VoteState>(key);
      queryClient.setQueryData<VoteState>(key, {
        count: Math.max(0, (before?.count ?? 0) + (isVoted ? 1 : -1)),
        hasVoted: isVoted,
      });
      if (isVoted) engineBus.emit('booth:upvoted', { boothId });
      return { before };
    },
    onError: (error, _isVoted, context) => {
      queryClient.setQueryData(key, context?.before);
      showToast(socialErrorText(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['votes', boothId] }),
  });

  const count = votes.data?.count ?? 0;
  const hasVoted = votes.data?.hasVoted ?? false;
  const countText = (
    <span data-testid="vote-count" className="tabular-nums">
      {count}
    </span>
  );
  if (!userId) {
    return (
      <button
        type="button"
        onClick={() => openSignIn(`/b/${slug}`)}
        className="rounded-xl bg-ink-3 px-4 py-2 font-semibold hover:bg-ink"
        data-testid="vote-button"
      >
        <span aria-hidden="true">♡</span> {countText} · Sign in to upvote
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={hasVoted}
      disabled={votes.isPending}
      onClick={() => mutation.mutate(!hasVoted)}
      className={`rounded-xl px-4 py-2 font-semibold disabled:opacity-60 ${
        hasVoted ? 'bg-pink-500/25 text-pink-200' : 'bg-ink-3 hover:bg-ink'
      }`}
      data-testid="vote-button"
    >
      <span aria-hidden="true">{hasVoted ? '♥' : '♡'}</span> {countText}
      <span className="sr-only">
        {hasVoted ? ' upvotes. Remove your upvote' : ' upvotes. Upvote'}
      </span>
    </button>
  );
}
