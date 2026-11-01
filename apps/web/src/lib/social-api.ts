import {
  GUESTBOOK_PAGE_SIZE,
  type GuestbookEntryPublic,
  GuestbookInput,
  type MakerPublic,
  ReportInput,
} from '@shipfair/shared';
import {
  GUESTBOOK_PUBLIC_COLUMNS,
  GuestbookEntryPublicFromRow,
  MAKER_COLUMNS,
  MakerFromRow,
} from './db.ts';
import { loadSupabase, type Supabase } from './supabase.ts';

// Votes, guestbook entries, reports and player profiles (prompt 12). Straight to Supabase under
// RLS: the policies, the guestbook filter trigger and the rate limits are the real fences. Every
// input is parsed with the shared schema first, and every row on the way back.

/** Error codes the social calls raise; `ui/errors.ts` turns them into friendly text. */
export type SocialErrorCode =
  | 'rate_limited'
  | 'not_allowed'
  | 'already_reported'
  | 'no_permission'
  | 'invalid'
  | 'network';

export class SocialError extends Error {
  readonly code: SocialErrorCode;

  constructor(code: SocialErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SocialError';
    this.code = code;
  }
}

interface PostgrestLikeError {
  code?: string;
  hint?: string | null;
  message: string;
}

/** Postgres errors from the social tables and their triggers (ARCHITECTURE.md §5). */
function fromDbError(error: PostgrestLikeError): SocialError {
  if (error.hint === 'rate_limited') return new SocialError('rate_limited', error.message);
  if (error.code === '23514') return new SocialError('not_allowed', error.message);
  if (error.code === '23505') return new SocialError('already_reported', error.message);
  if (error.code === '42501') return new SocialError('no_permission', error.message);
  return new SocialError('network', error.message, { cause: error });
}

// --- votes ---------------------------------------------------------------------------------------

export interface VoteState {
  count: number;
  hasVoted: boolean;
}

/** The booth's total (`booth_vote_counts`) and whether `userId` voted (their own row, RLS). */
export async function fetchVotes(
  client: Supabase,
  boothId: string,
  userId: string | null,
): Promise<VoteState> {
  const [counts, mine] = await Promise.all([
    client.from('booth_vote_counts').select('votes').eq('booth_id', boothId).maybeSingle(),
    userId
      ? client
          .from('booth_votes')
          .select('booth_id')
          .eq('booth_id', boothId)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (counts.error) throw fromDbError(counts.error);
  if (mine.error) throw fromDbError(mine.error);
  return { count: counts.data?.votes ?? 0, hasVoted: mine.data !== null };
}

/** Upvotes (or takes the vote back). A second upvote is a no-op, not an error. */
export async function setVote(
  client: Supabase,
  boothId: string,
  userId: string,
  isVoted: boolean,
): Promise<void> {
  const { error } = isVoted
    ? await client
        .from('booth_votes')
        .upsert(
          { booth_id: boothId, user_id: userId },
          { onConflict: 'booth_id,user_id', ignoreDuplicates: true },
        )
    : await client.from('booth_votes').delete().eq('booth_id', boothId).eq('user_id', userId);
  if (error) throw fromDbError(error);
}

// --- guestbook -----------------------------------------------------------------------------------

export interface GuestbookPage {
  entries: GuestbookEntryPublic[];
  /** Pass to the next call for older entries; null on the last page. */
  nextBefore: number | null;
}

/** Visible entries, newest first, GUESTBOOK_PAGE_SIZE at a time (keyset on the id). */
export async function fetchGuestbook(
  client: Supabase,
  boothId: string,
  before: number | null,
): Promise<GuestbookPage> {
  let query = client
    .from('guestbook_public')
    .select(GUESTBOOK_PUBLIC_COLUMNS.join(','))
    .eq('booth_id', boothId)
    .order('id', { ascending: false })
    .limit(GUESTBOOK_PAGE_SIZE + 1);
  if (before !== null) query = query.lt('id', before);
  const { data, error } = await query;
  if (error) throw fromDbError(error);
  const rows = (data ?? []).map((row) => GuestbookEntryPublicFromRow.parse(row));
  const entries = rows.slice(0, GUESTBOOK_PAGE_SIZE);
  const last = entries.at(-1);
  return { entries, nextBefore: rows.length > GUESTBOOK_PAGE_SIZE && last ? last.id : null };
}

/** Signs a booth's guestbook. The database censors the text, so refetch to see what was kept. */
export async function postGuestbook(
  client: Supabase,
  userId: string,
  input: GuestbookInput,
): Promise<void> {
  const parsed = GuestbookInput.safeParse(input);
  if (!parsed.success) throw new SocialError('invalid', parsed.error.message);
  const { error } = await client
    .from('guestbook_entries')
    .insert({ booth_id: parsed.data.boothId, author_id: userId, body: parsed.data.body });
  if (error) throw fromDbError(error);
}

/** A booth owner hides an entry on their booth (one way; staff can unhide). */
export async function hideGuestbookEntry(client: Supabase, entryId: number): Promise<void> {
  const { error } = await client
    .from('guestbook_entries')
    .update({ hidden: true })
    .eq('id', entryId);
  if (error) throw fromDbError(error);
}

// --- reports and profiles ------------------------------------------------------------------------

/** Files a report as `userId`. One open report per person per target (`already_reported`). */
export async function submitReport(
  client: Supabase,
  userId: string,
  input: ReportInput,
): Promise<void> {
  const parsed = ReportInput.safeParse(input);
  if (!parsed.success) throw new SocialError('invalid', parsed.error.message);
  const { targetType, targetId, reason, note, context } = parsed.data;
  const { error } = await client.from('reports').insert({
    reporter_id: userId,
    target_type: targetType,
    target_id: targetId,
    reason,
    note: note || null,
    context: context && context.length > 0 ? context : null,
  });
  if (error) throw fromDbError(error);
}

/** A player's public handle, name and links (the mini profile card). Null if there is none. */
export async function fetchMaker(client: Supabase, userId: string): Promise<MakerPublic | null> {
  const { data, error } = await client
    .from('public_profiles')
    .select(MAKER_COLUMNS.join(','))
    .eq('id', userId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data ? MakerFromRow.parse(data) : null;
}

/** The browser Supabase client, or a `network` error when this build has none. */
export async function socialClient(): Promise<Supabase> {
  const client = await loadSupabase();
  if (!client) throw new SocialError('network', 'Supabase is not configured in this build');
  return client;
}
