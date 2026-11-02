import { queryOptions, useQuery } from '@tanstack/react-query';
import { loadWorld } from '../lib/world-source.ts';

/** Shared by the hook and the boot prefetch (lib/boot.ts), so both hit the same cache entry. */
export const worldQueryOptions = (search: string) =>
  queryOptions({
    queryKey: ['world', search],
    queryFn: () => loadWorld(search),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: 1,
  });

/**
 * The world snapshot (server state, so TanStack Query). Fetched once per page: the city is built
 * from it, and live changes arrive through the realtime notices (prompt 11), not refetches.
 */
export function useWorldQuery(search: string) {
  return useQuery(worldQueryOptions(search));
}
