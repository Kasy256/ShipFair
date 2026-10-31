begin;
\ir _helpers.psql
select plan(16);

select tests.create_user('walker') as walker_id \gset
select tests.create_user('troll') as troll_id \gset
select tests.create_user('alias') as alias_id \gset
select tests.create_booth(:'walker_id', 'stats-booth') as booth_id \gset
select tests.create_booth(:'walker_id', 'other-booth') as other_id \gset

insert into public.bans (user_id, reason) values (:'troll_id', 'spam');
insert into auth.identities (id, user_id, provider_id, provider, identity_data)
values (gen_random_uuid(), :'alias_id', '9001', 'github', '{"sub":"9001"}');
insert into public.banned_identities (identity_hash, reason)
values (encode(sha256(convert_to('github:9001', 'UTF8')), 'hex'), 'ban evasion');

-- Privileges -------------------------------------------------------------------------------------
select ok(
  has_function_privilege('service_role', 'public.realtime_player(uuid, boolean)', 'execute'),
  'the service role may call realtime_player'
);
select ok(
  not has_function_privilege('authenticated', 'public.realtime_player(uuid, boolean)', 'execute'),
  'signed-in users may not probe other players'
);
select ok(
  not has_function_privilege('anon', 'public.realtime_player(uuid, boolean)', 'execute'),
  'guests may not probe players'
);
select ok(
  has_function_privilege('service_role', 'public.ingest_booth_stats(jsonb)', 'execute'),
  'the service role may ingest stats'
);
select ok(
  not has_function_privilege('authenticated', 'public.ingest_booth_stats(jsonb)', 'execute'),
  'signed-in users may not write stats'
);
select ok(
  not has_function_privilege('anon', 'public.ingest_booth_stats(jsonb)', 'execute'),
  'guests may not write stats'
);

set local role service_role;

-- realtime_player --------------------------------------------------------------------------------
select is(
  public.realtime_player(:'walker_id') -> 'profile' ->> 'handle',
  'walker',
  'returns the profile handle'
);
select is(
  (public.realtime_player(:'walker_id') ->> 'banned')::boolean,
  false,
  'an ordinary user is not banned'
);
select is(
  (public.realtime_player(:'troll_id') ->> 'banned')::boolean,
  true,
  'a row in bans means banned'
);
select is(
  (public.realtime_player(:'alias_id') ->> 'banned')::boolean,
  true,
  'a banned identity means banned too'
);
select is(
  public.realtime_player(:'walker_id', false) -> 'profile',
  'null'::jsonb,
  'with_profile = false skips the profile'
);
select is(
  (public.realtime_player(gen_random_uuid()) -> 'profile'),
  'null'::jsonb,
  'an unknown user has no profile'
);

-- ingest_booth_stats -----------------------------------------------------------------------------
select is(
  public.ingest_booth_stats(jsonb_build_array(
    jsonb_build_object('boothId', :'booth_id', 'day', '2026-10-31', 'visits', 3, 'uniqueVisitors', 2),
    jsonb_build_object('boothId', :'booth_id', 'day', '2026-10-31', 'visits', 1, 'uniqueVisitors', 1),
    jsonb_build_object('boothId', :'other_id', 'day', '2026-10-31', 'visits', 5, 'uniqueVisitors', 4),
    jsonb_build_object('boothId', gen_random_uuid(), 'day', '2026-10-31', 'visits', 9, 'uniqueVisitors', 9)
  )),
  2,
  'writes one row per existing booth-day and skips unknown booths'
);
select ok(
  (select visits = 4 and unique_visitors = 3 from public.booth_stats_daily
   where booth_id = :'booth_id' and day = '2026-10-31'),
  'duplicate entries in one batch are summed'
);
select public.ingest_booth_stats(jsonb_build_array(
  jsonb_build_object('boothId', :'booth_id', 'day', '2026-10-31', 'visits', 2, 'uniqueVisitors', 1)
));
select ok(
  (select visits = 6 and unique_visitors = 4 from public.booth_stats_daily
   where booth_id = :'booth_id' and day = '2026-10-31'),
  'a later batch adds to the existing counts'
);
select is(public.ingest_booth_stats('[]'::jsonb), 0, 'an empty batch writes nothing');

select * from finish();
rollback;
