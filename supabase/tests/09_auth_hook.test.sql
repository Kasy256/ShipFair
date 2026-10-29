begin;
select plan(8);

insert into public.banned_identities (identity_hash, reason)
values (encode(sha256(convert_to('github:4242', 'UTF8')), 'hex'), 'test');
insert into public.banned_identities (identity_hash, reason, until)
values (encode(sha256(convert_to('google:old-ban', 'UTF8')), 'hex'), 'test', now() - interval '1 day');

-- Payloads shaped like GoTrue's before-user-created event for an OAuth sign-up.
create function pg_temp.event(provider text, provider_id text, with_identity boolean default true)
returns jsonb
language sql
as $$
  select jsonb_build_object('user', jsonb_build_object(
    'app_metadata', jsonb_build_object('provider', provider),
    'user_metadata', jsonb_build_object('sub', provider_id),
    'identities', case when with_identity then jsonb_build_array(jsonb_build_object(
      'identity_id', gen_random_uuid(), 'id', provider_id, 'provider', provider,
      'identity_data', jsonb_build_object('sub', provider_id)
    )) else '[]'::jsonb end
  ));
$$;

select ok(
  has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'),
  'Supabase Auth may call the hook'
);

-- Called as postgres: supabase_auth_admin can't be assumed in tests, its grant is checked above.
select is(
  public.hook_before_user_created(pg_temp.event('github', '4242')) -> 'error' ->> 'http_code', '403',
  'a banned GitHub identity is refused'
);
select ok(
  public.hook_before_user_created(pg_temp.event('github', '4242')) -> 'error' ->> 'message' like 'account_banned:%',
  'the refusal carries the account_banned code for the web app'
);
select is(
  public.hook_before_user_created(pg_temp.event('github', '4242', false)) -> 'error' ->> 'http_code', '403',
  'the ban is found from the user metadata when there are no identities'
);
select is(public.hook_before_user_created(pg_temp.event('github', '777')), '{}'::jsonb, 'other identities sign up');
select is(
  public.hook_before_user_created(pg_temp.event('google', '4242')), '{}'::jsonb,
  'the same id on another provider is a different identity'
);
select is(
  public.hook_before_user_created(pg_temp.event('google', 'old-ban')), '{}'::jsonb,
  'an expired ban lets the identity sign up'
);

set local role authenticated;
select throws_ok(
  $$select public.hook_before_user_created('{}'::jsonb)$$, '42501', null,
  'clients cannot call the hook'
);
reset role;

select * from finish();
rollback;
