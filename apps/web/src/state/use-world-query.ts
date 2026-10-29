import { useQuery } from '@tanstack/react-query';
import { loadWorld } from '../lib/world-source.ts';

/**
 * The world snapshot (server state, so TanStack Query). Fetched once per page: the city is built
 * from it, and live changes arrive through the realtime notices (prompt 11), not refetches.
 */
export function useWorldQuery(search: string) {
  return useQuery({
    queryKey: ['world', search],
    queryFn: () => loadWorld(search),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
