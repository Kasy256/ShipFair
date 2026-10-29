-- Prompt 07: a banned OAuth identity can't sign up again after deleting its account
-- (TRUST_AND_SAFETY.md "Accounts"). Supabase Auth calls this before it creates a user
-- (`[auth.hook.before_user_created]` in config.toml; enable it per project in the dashboard).
-- Identities hash as in is_not_banned(): sha256(provider || ':' || provider user id).
--
-- For an OAuth sign-up the payload's `user.identities` holds the new identity, with the provider
-- user id in `id` (GoTrue's JSON name for provider_id) and `identity_data.sub`. The provider and
-- `user_metadata.sub` are checked too, in case a GoTrue version sends no identities. (Email
-- sign-ups, local only, have neither.)

create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from (
      select i ->> 'provider' as provider,
        coalesce(i ->> 'provider_id', i -> 'identity_data' ->> 'sub', i ->> 'id') as provider_id
      from jsonb_array_elements(coalesce(event -> 'user' -> 'identities', '[]'::jsonb)) as i
      union all
      select event -> 'user' -> 'app_metadata' ->> 'provider',
        coalesce(event -> 'user' -> 'user_metadata' ->> 'provider_id', event -> 'user' -> 'user_metadata' ->> 'sub')
    ) as ids
    join public.banned_identities as b
      on b.identity_hash = encode(sha256(convert_to(ids.provider || ':' || ids.provider_id, 'UTF8')), 'hex')
    where ids.provider is not null
      and ids.provider_id is not null
      and (b.until is null or b.until > now())
  ) then
    -- The web app matches `account_banned` and shows its own friendly text.
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'account_banned: this account can''t be used here'
    ));
  end if;
  return '{}'::jsonb;
end;
$$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
