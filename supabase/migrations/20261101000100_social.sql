-- Prompt 12: social features. The guestbook profanity filter, booth owners hiding entries on
-- their booths, the public guestbook view, and chat lines attached to reports.

-- Guestbook filter -----------------------------------------------------------------------------

-- The profanity filter as a censor: each word has_profanity() flags becomes ★s, like the client's
-- filterProfanity. has_profanity() is generated from packages/shared/src/blocklist.ts by
-- `pnpm db:sync-blocklist`, so this wrapper follows the list without being regenerated. It works
-- per word where the client censors matched spans, so "fuck!" becomes "★★★★★". Text is normalised
-- first, as normaliseText() does: NFKC, invisible and control characters removed, whitespace
-- collapsed and trimmed.
create function public.censor_profanity(input text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  clean text := normalize(coalesce(input, ''), NFKC);
  censored text;
begin
  clean := regexp_replace(
    clean,
    '[\u0001-\u0008\u000E-\u001F\u007F-\u009F­͏؜ᅟᅠ᠎​-‏‪-‮⁠-⁤⁦-⁯ㅤ﻿ﾠ]',
    '',
    'g'
  );
  clean := btrim(regexp_replace(clean, '\s+', ' ', 'g'));
  if clean = '' or not public.has_profanity(clean) then
    return clean;
  end if;
  select string_agg(
           case when public.has_profanity(word) then repeat('★', char_length(word)) else word end,
           ' ' order by n
         )
    into censored
    from regexp_split_to_table(clean, ' ') with ordinality as t(word, n);
  return censored;
end;
$$;

-- Runs before guestbook_entries_rate_limit (triggers fire in name order). A phrase that only
-- matches across words ("double penetration") survives the per-word censor and is refused.
create function public.guestbook_filter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.body := public.censor_profanity(new.body);
  if public.has_profanity(new.body) then
    raise exception 'guestbook entry has words that are not allowed'
      using errcode = '23514', hint = 'profanity';
  end if;
  return new;
end;
$$;

create trigger guestbook_entries_filter
  before insert or update of body on public.guestbook_entries
  for each row execute function public.guestbook_filter();

-- Owners hide entries on their booths -------------------------------------------------------------

-- Clients may change only `hidden`, and only through the policy below.
revoke update on public.guestbook_entries from anon, authenticated;
grant update (hidden) on public.guestbook_entries to authenticated;

-- Owners see every entry on their booths, hidden ones included. Postgres also checks an updated
-- row against the select policies, so without this an owner could never hide one.
create policy guestbook_entries_select_owner on public.guestbook_entries
  for select to authenticated
  using (
    exists (
      select 1 from public.booths as b
      where b.id = booth_id and b.owner_id = (select auth.uid())
    )
  );

-- One way: an owner can hide a visible entry on their own booth but never unhide one, so they
-- can't bring back an entry a moderator hid. Staff unhide through admin_action.
create policy guestbook_entries_owner_hide on public.guestbook_entries
  for update to authenticated
  using (
    not hidden
    and (select public.is_not_banned((select auth.uid())))
    and exists (
      select 1 from public.booths as b
      where b.id = booth_id and b.owner_id = (select auth.uid())
    )
  )
  with check (
    hidden
    and exists (
      select 1 from public.booths as b
      where b.id = booth_id and b.owner_id = (select auth.uid())
    )
  );

-- The booth panel's list: visible entries with their author's handle and name. security_invoker,
-- so the guestbook and profile policies and column grants still apply.
create view public.guestbook_public
with (security_invoker = true) as
select
  g.id,
  g.booth_id,
  g.author_id,
  p.handle as author_handle,
  p.display_name as author_name,
  g.body,
  g.created_at
from public.guestbook_entries as g
join public.profiles as p on p.id = g.author_id
where not g.hidden;

grant select on public.guestbook_public to anon, authenticated;

-- Chat lines attached to reports ------------------------------------------------------------------

-- `context` is the reported player's last chat lines the reporter received:
-- [{text, ts}], at most 20, text 1–160 characters, ts epoch ms (ReportContext in
-- packages/shared). Kept for 30 days (the scheduled cleanup arrives in prompt 15).
create function public.report_context_valid(context jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  line jsonb;
begin
  if context is null then
    return true;
  end if;
  if jsonb_typeof(context) <> 'array' or jsonb_array_length(context) > 20 then
    return false;
  end if;
  for line in select value from jsonb_array_elements(context) loop
    if jsonb_typeof(line) <> 'object'
      or (select count(*) from jsonb_object_keys(line)) <> 2
      or jsonb_typeof(line -> 'text') is distinct from 'string'
      or char_length(line ->> 'text') not between 1 and 160
      or jsonb_typeof(line -> 'ts') is distinct from 'number'
      or (line ->> 'ts')::numeric < 0
      or (line ->> 'ts')::numeric <> trunc((line ->> 'ts')::numeric)
    then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.reports
  add column context jsonb,
  add constraint reports_context_valid check (public.report_context_valid(context)),
  add constraint reports_context_chat_only check (context is null or target_type in ('user', 'chat'));
