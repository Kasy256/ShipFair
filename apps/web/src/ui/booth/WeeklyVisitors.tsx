import { useQuery } from '@tanstack/react-query';
import { fetchWeeklyVisitors } from '../../lib/passport-api.ts';
import { socialClient } from '../../lib/social-api.ts';

/** Shards report visits once a minute; a few minutes of staleness costs nothing here. */
const STALE_MS = 5 * 60_000;

/** "N visitors this week" (`booth_stats_week`), cached per booth. Nothing while unknown or zero. */
export function WeeklyVisitors({ boothId }: { boothId: string }) {
  const visitors = useQuery({
    queryKey: ['booth-week', boothId],
    queryFn: async () => fetchWeeklyVisitors(await socialClient(), boothId),
    staleTime: STALE_MS,
  });
  const n = visitors.data ?? 0;
  if (n === 0) return null;
  return (
    <li
      className="inline-flex items-center gap-1.5 rounded-full bg-ink-3 px-2.5 py-0.5 font-semibold text-xs"
      data-testid="booth-visitors"
    >
      <span aria-hidden="true">👣</span>
      {n} {n === 1 ? 'visitor' : 'visitors'} this week
    </li>
  );
}
