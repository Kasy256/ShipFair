import {
  BOOTH_STATS_CHART_DAYS,
  type BoothPublic,
  type BoothStatsDay,
  type District,
  PassportAnswer,
  type ProfilePublic,
  type Stamp,
  type StampKey,
} from '@shipfair/shared';
import {
  BOOTH_PUBLIC_COLUMNS,
  BoothPublicFromRow,
  BoothStatsDayFromRow,
  DistrictFromRow,
  ProfilePublicFromRow,
  StampFromRow,
} from './db.ts';
import type { Supabase } from './supabase.ts';

// Passport and booth stats (prompt 13). Stamps are claimed through the Worker, which checks them
// against evidence; everything readable (stamps, weekly visitors, an owner's own stats, public
// profiles) comes straight from Supabase under RLS.

export class PassportError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PassportError';
    this.status = status;
  }
}

async function post(path: string, token: string, body: unknown): Promise<PassportAnswer> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new PassportError(res.status, `${path} answered ${res.status}`);
  return PassportAnswer.parse(await res.json());
}

/** `POST /api/passport/stamp`: what is held now and what may still arrive. */
export const claimStamps = (token: string, stamps: readonly StampKey[]) =>
  post('/api/passport/stamp', token, { stamps });

/** `POST /api/passport/merge`: a guest's stamps, once, after signing in. */
export const mergeGuestStamps = (token: string, guestId: string, stamps: readonly StampKey[]) =>
  post('/api/passport/merge', token, { guestId, stamps });

/** Every stamp a user holds (public). */
export async function fetchStamps(client: Supabase, userId: string): Promise<Stamp[]> {
  const { data, error } = await client
    .from('passport_stamps')
    .select('stamp,created_at')
    .eq('user_id', userId)
    .order('created_at');
  if (error) throw new PassportError(503, error.message);
  return (data ?? []).flatMap((row) => {
    const stamp = StampFromRow.safeParse(row);
    return stamp.success ? [stamp.data] : [];
  });
}

/** "Try it" for the owner's chart. Fire and forget: it must never slow the click down. */
export function recordTryClick(boothId: string): void {
  fetch(`/api/booths/${boothId}/try`, { method: 'POST', keepalive: true }).catch((error: unknown) =>
    console.warn('Try click not counted', error),
  );
}

/** Unique visitors over the last 7 days (`booth_stats_week`). */
export async function fetchWeeklyVisitors(client: Supabase, boothId: string): Promise<number> {
  const { data, error } = await client
    .from('booth_stats_week')
    .select('visitors')
    .eq('booth_id', boothId)
    .maybeSingle();
  if (error) throw new PassportError(503, error.message);
  return data?.visitors ?? 0;
}

/** UTC day string `days` before `now`. */
export const dayBefore = (now: number, days: number) =>
  new Date(now - days * 86_400_000).toISOString().slice(0, 10);

/**
 * The owner's last BOOTH_STATS_CHART_DAYS days per booth, zero-filled and oldest first, so the
 * chart always has the same number of bars.
 */
export async function fetchBoothStats(
  client: Supabase,
  boothIds: readonly string[],
  now = Date.now(),
): Promise<Map<string, BoothStatsDay[]>> {
  const out = new Map<string, BoothStatsDay[]>();
  if (boothIds.length === 0) return out;
  const from = dayBefore(now, BOOTH_STATS_CHART_DAYS - 1);
  const { data, error } = await client
    .from('booth_stats_daily')
    .select('booth_id,day,unique_visitors,try_clicks')
    .in('booth_id', [...boothIds])
    .gte('day', from);
  if (error) throw new PassportError(503, error.message);
  const rows = new Map<string, BoothStatsDay>();
  for (const raw of data ?? []) {
    const row = BoothStatsDayFromRow.safeParse(raw);
    if (row.success) rows.set(`${row.data.boothId}/${row.data.day}`, row.data);
  }
  for (const boothId of boothIds) {
    const days: BoothStatsDay[] = [];
    for (let i = BOOTH_STATS_CHART_DAYS - 1; i >= 0; i--) {
      const day = dayBefore(now, i);
      days.push(rows.get(`${boothId}/${day}`) ?? { boothId, day, visitors: 0, tryClicks: 0 });
    }
    out.set(boothId, days);
  }
  return out;
}

/** Every district (pages and unlock rules need them away from the city too). */
export async function fetchDistricts(client: Supabase): Promise<District[]> {
  const { data, error } = await client.from('districts').select('*').order('sort_order');
  if (error) throw new PassportError(503, error.message);
  return (data ?? []).flatMap((row) => {
    const district = DistrictFromRow.safeParse(row);
    return district.success ? [district.data] : [];
  });
}

export interface PublicPassport {
  profile: ProfilePublic;
  stamps: Stamp[];
  booths: BoothPublic[];
}

/** `/u/:handle`: the profile, stamps and live booths, or null for an unknown handle. */
export async function fetchPublicPassport(
  client: Supabase,
  handle: string,
): Promise<PublicPassport | null> {
  const { data, error } = await client
    .from('public_profiles')
    .select('id,handle,display_name,avatar_style,links')
    .eq('handle', handle)
    .maybeSingle();
  if (error) throw new PassportError(503, error.message);
  const profile = ProfilePublicFromRow.safeParse(data);
  if (!profile.success) return null;
  const [stamps, booths] = await Promise.all([
    fetchStamps(client, profile.data.id),
    client
      .from('booths')
      .select(BOOTH_PUBLIC_COLUMNS.join(','))
      .eq('owner_id', profile.data.id)
      .eq('status', 'approved'),
  ]);
  if (booths.error) throw new PassportError(503, booths.error.message);
  return {
    profile: profile.data,
    stamps,
    booths: (booths.data ?? []).flatMap((row) => {
      const booth = BoothPublicFromRow.safeParse(row);
      return booth.success ? [booth.data] : [];
    }),
  };
}
