-- Helpers used by policies, and the public face of profiles.

-- Security definer so policies can call these without the caller being able to read the tables.
create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('moderator', 'admin')
  );
$$;

-- False while the user has an active ban, or while any of their OAuth identities is banned (that
-- ban survives account deletion through banned_identities).
create function public.is_not_banned(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select uid is not null
    and not exists (
      select 1
      from public.bans
      where user_id = uid
        and (until is null or until > now())
    )
    and not exists (
      select 1
      from auth.identities as i
      join public.banned_identities as b
        on b.identity_hash = encode(sha256(convert_to(i.provider || ':' || i.provider_id, 'UTF8')), 'hex')
      where i.user_id = uid
        and (b.until is null or b.until > now())
    );
$$;

-- Policies call it as `authenticated`. Nobody else needs to probe other users' ban status.
revoke execute on function public.is_not_banned(uuid) from public, anon;

-- security_invoker: reads go through the profiles policy and column grants, and `role` isn't
-- granted to clients (see the RLS migration).
create view public.public_profiles
with (security_invoker = true) as
select id, handle, display_name, avatar_style, links, created_at
from public.profiles;
