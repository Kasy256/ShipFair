-- Row level security for every table (ARCHITECTURE.md §5). Tables with no policy here are service
-- role only: booth_stats_daily, moderation_log, bans, banned_identities.
-- auth.uid() and the helpers are wrapped in (select ...) so Postgres evaluates them once per query.
-- A banned user can't write anything.

-- districts ------------------------------------------------------------------------------------

create policy districts_select on public.districts
  for select to anon, authenticated
  using (true);

-- profiles -------------------------------------------------------------------------------------

-- Every row is readable, but only the public columns are granted, so `role` stays private.
-- Clients read through the public_profiles view.
revoke select, insert, update, delete on public.profiles from anon, authenticated;
grant select (id, handle, display_name, avatar_style, links, created_at) on public.profiles
  to anon, authenticated;
grant update (handle, display_name, avatar_style, links) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to anon, authenticated
  using (true);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and (select public.is_not_banned((select auth.uid()))));

-- booths ---------------------------------------------------------------------------------------

create policy booths_select on public.booths
  for select to anon, authenticated
  using (status = 'approved' or owner_id = (select auth.uid()));

create policy booths_insert_own on public.booths
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and status = 'draft'
    and (select public.is_not_banned((select auth.uid())))
  );

create policy booths_update_own on public.booths
  for update to authenticated
  using (owner_id = (select auth.uid()) and status in ('draft', 'pending', 'rejected'))
  with check (
    owner_id = (select auth.uid())
    and status in ('draft', 'pending', 'rejected')
    and (select public.is_not_banned((select auth.uid())))
  );

-- RLS can't restrict columns, so this trigger does. Callers other than the service role (and
-- postgres, which owns the security definer functions, e.g. auto-hide) may never set or change
-- status, tier, approved_at, reject_reason or owner_id, may not change the slug once approved, and
-- must insert drafts. An owner edit to a pending booth sends it back to draft, so the pre-screen
-- runs again on resubmit.
create function public.booths_guard_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft'
      or new.tier <> 'stall'
      or new.approved_at is not null
      or new.reject_reason is not null
      or new.owner_id is distinct from (select auth.uid())
    then
      raise exception 'booths: new booths must be drafts owned by the caller'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
    or new.tier is distinct from old.tier
    or new.approved_at is distinct from old.approved_at
    or new.reject_reason is distinct from old.reject_reason
    or new.owner_id is distinct from old.owner_id
  then
    raise exception 'booths: status, tier, approved_at, reject_reason and owner_id are read-only'
      using errcode = '42501';
  end if;

  if old.approved_at is not null and new.slug is distinct from old.slug then
    raise exception 'booths: the slug is fixed once a booth is approved'
      using errcode = '42501';
  end if;

  if old.status = 'pending' then
    new.status := 'draft';
  end if;

  return new;
end;
$$;

create trigger booths_guard_columns
  before insert or update on public.booths
  for each row execute function public.booths_guard_columns();

-- booth_votes ----------------------------------------------------------------------------------

-- Own rows only (to show "you voted" and to allow un-voting). Totals come from booth_vote_counts.
create policy booth_votes_select_own on public.booth_votes
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy booth_votes_insert_own on public.booth_votes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_not_banned((select auth.uid())))
    and exists (select 1 from public.booths as b where b.id = booth_id and b.status = 'approved')
  );

create policy booth_votes_delete_own on public.booth_votes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- guestbook_entries ----------------------------------------------------------------------------

create policy guestbook_entries_select on public.guestbook_entries
  for select to anon, authenticated
  using (not hidden);

create policy guestbook_entries_insert_own on public.guestbook_entries
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and not hidden
    and (select public.is_not_banned((select auth.uid())))
    and exists (select 1 from public.booths as b where b.id = booth_id and b.status = 'approved')
  );

-- passport_stamps ------------------------------------------------------------------------------

-- Stamps are awarded by the API (service role). Users can read their own.
create policy passport_stamps_select_own on public.passport_stamps
  for select to authenticated
  using (user_id = (select auth.uid()));

-- reports --------------------------------------------------------------------------------------

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'open'
    and (select public.is_not_banned((select auth.uid())))
  );

create policy reports_select_staff on public.reports
  for select to authenticated
  using ((select public.is_staff()));
