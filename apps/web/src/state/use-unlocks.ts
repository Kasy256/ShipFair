import { isUnlockMet } from '@shipfair/shared';
import { useQuery } from '@tanstack/react-query';
import { fetchDistricts, fetchStamps } from '../lib/passport-api.ts';
import { socialClient } from '../lib/social-api.ts';
import { usePassportStore } from './passport-store.ts';
import { useSessionStore } from './session-store.ts';
import { useWorldStore } from './world-store.ts';

/** Why a wardrobe item is locked, in words. */
export function unlockHint(rule: string): string {
  if (rule === 'stamp:district:all') return 'Unlocks with a stamp from every district';
  const milestone = rule.match(/^stamp:booths:(\d+)$/);
  if (milestone) return `Unlocks after opening ${milestone[1]} booths`;
  return 'Unlocks with a passport stamp';
}

/**
 * Whether a wardrobe unlock rule is met (prompt 13). Signed in: the stamps the server holds (the
 * database refuses a locked item on save anyway). Guests: their local stamps, since their look
 * never leaves the browser and the shard.
 */
export function useUnlocks(): (rule: string) => boolean {
  const userId = useSessionStore((s) => s.userId);
  const local = usePassportStore((s) => s.stamps);
  const worldDistricts = useWorldStore((s) => s.districtsById);
  const server = useQuery({
    queryKey: ['stamps', userId],
    queryFn: async () => fetchStamps(await socialClient(), userId ?? ''),
    enabled: userId !== null,
  });
  const districts = useQuery({
    queryKey: ['districts'],
    queryFn: async () => fetchDistricts(await socialClient()),
    enabled: worldDistricts.size === 0,
  });
  const stamps = new Set<string>(
    userId ? (server.data ?? []).map((s) => s.stamp) : [...local.keys()],
  );
  const slugs =
    worldDistricts.size > 0
      ? [...worldDistricts.values()].map((d) => d.slug)
      : (districts.data ?? []).map((d) => d.slug);
  return (rule) => isUnlockMet(rule, stamps, slugs);
}
