-- Prompt 07: account deletion. Booth media outlives the account by 30 days (TRUST_AND_SAFETY.md
-- "Privacy"); the cleanup job that purges these keys from R2 arrives in prompt 15.

create table public.pending_media_deletes (
  id bigint generated always as identity primary key,
  -- An R2 object key as booths store it (`u/<owner>/…`): no leading slash, no `..`.
  key text not null check (char_length(key) between 1 and 512 and key !~ '^/' and key !~ '\.\.'),
  purge_after timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now()
);
create index on public.pending_media_deletes (purge_after);

-- No policies and no grants: service role only.
alter table public.pending_media_deletes enable row level security;
revoke all on table public.pending_media_deletes from anon, authenticated;

-- Queues the user's booth media for deletion, then deletes the auth user, in one transaction:
-- the profile, booths, votes, guestbook entries, stamps and bans cascade from it. Either both
-- happen or neither, so no media is queued for an account that still exists. Returns the number
-- of keys queued. `/api/me/delete` calls it with the service role.
create function public.delete_account(uid uuid)
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
