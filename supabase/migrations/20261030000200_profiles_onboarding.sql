-- Prompt 07: choosing a handle on first sign-in, case-insensitive handles, and the name filter.

-- The handle check already allows only lowercase, but uniqueness must not depend on that check
-- staying as it is: `Alice` and `alice` are the same person on a name tag.
create unique index profiles_handle_lower_key on public.profiles (lower(handle));

-- Set when the user finishes first-run onboarding. Null means the signup trigger's random
-- `maker_xxxxxx` handle is still in place and the web app shows onboarding.
alter table public.profiles add column onboarded_at timestamptz;

-- Not sensitive, but only signed-in users need it (to read their own row).
grant select (onboarded_at) on public.profiles to authenticated;
grant update (onboarded_at) on public.profiles to authenticated;

-- Handles and display names are on every name tag, so they pass the same filter as chat
-- (TRUST_AND_SAFETY.md). A profane display name from OAuth metadata becomes "Maker" instead of
-- failing the signup; any later change is refused with hint 'profanity'.
create function public.profiles_guard_names()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public.has_profanity(new.display_name) then
      new.display_name := 'Maker';
    end if;
    return new;
  end if;
  if (new.handle is distinct from old.handle and public.has_profanity(new.handle))
    or (new.display_name is distinct from old.display_name and public.has_profanity(new.display_name)) then
    raise exception 'handle or display name not allowed'
      using errcode = '23514', hint = 'profanity';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_names
  before insert or update of handle, display_name on public.profiles
  for each row execute function public.profiles_guard_names();

-- Live availability check for onboarding. True when `candidate` is a valid, clean handle that
-- nobody else has (any case). The caller's own current handle counts as available.
create function public.handle_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select candidate ~ '^[a-z0-9_]{3,20}$'
    and not public.has_profanity(candidate)
    and not exists (
      select 1
      from public.profiles
      where lower(handle) = lower(candidate)
        and id is distinct from (select auth.uid())
    );
$$;

revoke execute on function public.handle_available(text) from public, anon;
grant execute on function public.handle_available(text) to authenticated;
