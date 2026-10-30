-- Prompt 08: booth submission. Slugs de-duplicate themselves, a maker has at most 3 booths, and a
-- live booth's edits wait in booth_revisions until staff approve them.

-- Slugs ------------------------------------------------------------------------------------------

-- The client sends slugify(name) (`boothSlugBase` in packages/shared). Until the booth is
-- approved, a slug another booth already has becomes `<slug>-2`, `-3`, … (kept within 40 chars).
-- Security definer because the owner can't see other people's drafts under RLS. After approval
-- the slug is fixed (booths_guard_columns refuses changes), so this leaves it alone.
create function public.booths_unique_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text := new.slug;
  candidate text := new.slug;
  n integer := 1;
begin
  if new.approved_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new;
  end if;
  while exists (select 1 from public.booths as b where b.slug = candidate and b.id <> new.id) loop
    n := n + 1;
    candidate := rtrim(left(base, 40 - char_length('-' || n)), '-') || '-' || n;
  end loop;
  new.slug := candidate;
  return new;
end;
$$;

revoke execute on function public.booths_unique_slug() from public, anon, authenticated;

create trigger booths_unique_slug
  before insert or update of slug on public.booths
  for each row execute function public.booths_unique_slug();

-- Booth cap --------------------------------------------------------------------------------------

-- TRUST_AND_SAFETY.md "Limits": at most 3 booths per maker in v1, counting every status except
-- archived (drafts too, so the cap can't be dodged with a pile of drafts). The service role is
-- exempt (staff tools, seed). An advisory lock per owner serialises concurrent inserts.
create function public.booths_owner_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('booths_owner_limit:' || new.owner_id::text, 0));
  if (
    select count(*) from public.booths as b
    where b.owner_id = new.owner_id and b.status <> 'archived'
  ) >= 3 then
    raise exception 'booth limit: 3 booths per maker'
      using errcode = 'P0001', hint = 'booth_limit';
  end if;
  return new;
end;
$$;

create trigger booths_owner_limit
  before insert on public.booths
  for each row execute function public.booths_owner_limit();

-- Revisions --------------------------------------------------------------------------------------

create type public.revision_status as enum ('pending', 'approved', 'rejected');

-- An edit to a live booth (tagline, description, url and media only). The booth stays as it is
-- until staff approve the revision (prompt 09 applies it). One open revision per booth: a second
-- edit while one is pending replaces it. Written by `/api/booths/:id/revision` (service role).
create table public.booth_revisions (
  id uuid primary key default gen_random_uuid(),
  booth_id uuid not null references public.booths on delete cascade,
  owner_id uuid not null references public.profiles on delete cascade,
  tagline text not null check (char_length(tagline) between 10 and 90),
  description text check (char_length(description) <= 600),
  url text not null check (url ~ '^https://'),
  logo_key text not null,
  media jsonb not null default '[]'::jsonb,
  status public.revision_status not null default 'pending',
  reject_reason text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booth_revisions_media_keys_valid
    check (public.booth_media_keys_valid(owner_id, logo_key, media))
);

create unique index booth_revisions_one_open_idx
  on public.booth_revisions (booth_id) where status = 'pending';
create index booth_revisions_owner_id_idx on public.booth_revisions (owner_id);

create trigger booth_revisions_set_updated_at
  before update on public.booth_revisions
  for each row execute function public.set_updated_at();

alter table public.booth_revisions enable row level security;

-- Owners read their own revisions (for "My booths"). No client writes: the API validates,
-- checks the media and runs the pre-screen, then writes with the service role.
create policy booth_revisions_select_own on public.booth_revisions
  for select to authenticated
  using (owner_id = (select auth.uid()));

revoke insert, update, delete on table public.booth_revisions from anon, authenticated;

-- Account deletion -------------------------------------------------------------------------------

-- As before (20261030000300), plus revision media: those keys would otherwise be orphaned.
create or replace function public.delete_account(uid uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued integer;
begin
  insert into public.pending_media_deletes (key)
  select distinct k
  from (
    select b.logo_key as k
    from public.booths as b
    where b.owner_id = uid
    union all
    select m ->> 'key'
    from public.booths as b
    cross join lateral jsonb_array_elements(b.media) as m
    where b.owner_id = uid
    union all
    select r.logo_key
    from public.booth_revisions as r
    where r.owner_id = uid
    union all
    select m ->> 'key'
    from public.booth_revisions as r
    cross join lateral jsonb_array_elements(r.media) as m
    where r.owner_id = uid
  ) as keys
  where k is not null;
  get diagnostics queued = row_count;

  delete from auth.users where id = uid;
  if not found then
    raise exception 'no such user' using errcode = 'P0002', hint = 'not_found';
  end if;
  return queued;
end;
$$;

revoke execute on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
