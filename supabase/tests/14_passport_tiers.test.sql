begin;
\ir _helpers.psql
select plan(46);

select tests.create_user('walker') as walker_id \gset
select tests.create_user('second') as second_id \gset
select tests.create_user('banned_one') as banned_id \gset
select tests.create_user('tierowner') as owner_id \gset
select tests.create_booth(:'owner_id', 'passport-booth') as booth_id \gset
insert into public.bans (user_id, reason) values (:'banned_id', 'spam');

-- Stamp keys and access ---------------------------------------------------------------------------

select throws_ok(
  format($$insert into public.passport_stamps (user_id, stamp) values (%L, 'booths:2')$$, :'walker_id'),
  '23514', null, 'an unknown stamp key is refused'
);
insert into public.passport_stamps (user_id, stamp) values (:'second_id', 'squad');

select tests.logout_anon();
select is((select count(*)::int from public.passport_stamps where stamp = 'squad'), 1, 'anon reads stamps (public profiles)');
reset role;

select tests.login(:'walker_id');
select throws_ok(
  format($$insert into public.passport_stamps (user_id, stamp) values (%L, 'squad')$$, :'walker_id'),
  '42501', null, 'a user cannot write their own stamps'
);
select is_empty('select 1 from public.passport_evidence', 'evidence is invisible to users');
select throws_ok(
  format($$select public.award_stamps(%L)$$, :'walker_id'), '42501', null,
  'users cannot call award_stamps'
);
select throws_ok(
  $$select public.ingest_passport_evidence('[]')$$, '42501', null,
  'users cannot call ingest_passport_evidence'
);
reset role;

-- Evidence → stamps ----------------------------------------------------------------------------------

select is(
  public.award_stamps(:'walker_id', array['district:ai-agents', 'squad']), '{}'::text[],
  'nothing is awarded without evidence'
);

select is(
  public.ingest_passport_evidence(jsonb_build_array(
    jsonb_build_object('player', :'walker_id', 'kind', 'district', 'key', 'ai-agents'),
    jsonb_build_object('player', :'walker_id', 'kind', 'district', 'key', 'no-such-place'),
    jsonb_build_object('player', :'walker_id', 'kind', 'fact', 'key', 'first:chat')
  )), 3, 'evidence rows are stored'
);
select set_eq(
  format($$select stamp from public.passport_stamps where user_id = %L$$, :'walker_id'),
  array['district:ai-agents', 'first:chat'],
  'ingest awards what the evidence backs, and an unknown district earns nothing'
);
select is(
  public.ingest_passport_evidence(jsonb_build_array(
    jsonb_build_object('player', :'walker_id', 'kind', 'district', 'key', 'ai-agents')
  )), 0, 'repeated evidence is ignored'
);

select public.ingest_passport_evidence((
  select jsonb_agg(jsonb_build_object('player', :'walker_id', 'kind', 'booth', 'key', gen_random_uuid()))
  from generate_series(1, 10)
));
select ok(
  exists (select 1 from public.passport_stamps where user_id = :'walker_id' and stamp = 'booths:10')
  and exists (select 1 from public.passport_stamps where user_id = :'walker_id' and stamp = 'booths:1')
  and not exists (select 1 from public.passport_stamps where user_id = :'walker_id' and stamp = 'booths:50'),
  '10 visited booths earn booths:1 and booths:10, not booths:50'
);

insert into public.booth_votes (booth_id, user_id) values (:'booth_id', :'walker_id');
select is(
  public.award_stamps(:'walker_id', array['first:upvote', 'first:note']), array['first:upvote'],
  'a vote backs first:upvote; no guestbook entry, no first:note'
);
select is(
  public.award_stamps(:'walker_id', array['district:dev-tools']), '{}'::text[],
  'a claim with no evidence is not awarded'
);

select public.ingest_passport_evidence(jsonb_build_array(
  jsonb_build_object('player', :'walker_id', 'kind', 'fact', 'key', 'squad')
));
select ok(
  not exists (select 1 from public.passport_stamps where user_id = :'walker_id' and stamp = 'squad'),
  'squad evidence alone is not awarded at ingest'
);
select is(
  public.award_stamps(:'walker_id', array['squad']), array['squad'],
  'squad is awarded when the browser claims it and the shard backs it'
);

select public.ingest_passport_evidence(jsonb_build_array(
  jsonb_build_object('player', :'banned_id', 'kind', 'fact', 'key', 'first:chat')
));
select is(
  (select count(*)::int from public.passport_stamps where user_id = :'banned_id'), 0,
  'a banned user is awarded nothing'
);

-- Guest merge ---------------------------------------------------------------------------------------

select gen_random_uuid() as guest_id \gset
select public.ingest_passport_evidence(jsonb_build_array(
  jsonb_build_object('player', 'guest:' || :'guest_id', 'kind', 'district', 'key', 'dev-tools')
));
select is(
  public.merge_guest_passport(:'second_id', :'guest_id', array['district:dev-tools', 'district:design']),
  '{"awarded": ["district:dev-tools"], "pending": ["district:design"]}'::jsonb,
  'merge awards the backed claims and reports the rest as pending'
);
select is_empty(
  format($$select 1 from public.passport_evidence where player_key = %L$$, 'guest:' || :'guest_id'),
  'the guest evidence moved to the account'
);
select public.ingest_passport_evidence(jsonb_build_array(
  jsonb_build_object('player', 'guest:' || :'guest_id', 'kind', 'district', 'key', 'design')
));
select ok(
  exists (select 1 from public.passport_stamps where user_id = :'second_id' and stamp = 'district:design'),
  'later evidence for a merged guest id reaches the account'
);
select is(
  public.merge_guest_passport(:'walker_id', :'guest_id', array['district:dev-tools']),
  '{"awarded": [], "pending": []}'::jsonb,
  'a guest id merged into another account gives nothing back'
);
select throws_ok(
  format($$select public.merge_guest_passport(gen_random_uuid(), %L, '{}')$$, :'guest_id'),
  'P0001', null, 'merging into an unknown user fails'
);

-- Booth stats ----------------------------------------------------------------------------------------

select tests.create_booth(:'owner_id', 'stats-pending', 'pending') as pending_id \gset
insert into public.booth_stats_daily (booth_id, day, unique_visitors, visits, try_clicks) values
  (:'booth_id', (now() at time zone 'utc')::date, 5, 9, 1),
  (:'booth_id', (now() at time zone 'utc')::date - 6, 4, 4, 0),
  (:'booth_id', (now() at time zone 'utc')::date - 7, 100, 100, 0),
  (:'pending_id', (now() at time zone 'utc')::date, 3, 3, 0);

select tests.logout_anon();
select is(
  (select visitors from public.booth_stats_week where booth_id = :'booth_id'), 9,
  'the weekly view sums the last 7 days'
);
select is_empty(
  format($$select 1 from public.booth_stats_week where booth_id = %L$$, :'pending_id'),
  'the weekly view shows approved booths only'
);
select is_empty('select 1 from public.booth_stats_daily', 'anon cannot read daily stats');
reset role;

select tests.login(:'owner_id');
select is(
  (select count(*)::int from public.booth_stats_daily where booth_id = :'booth_id'), 3,
  'the owner reads their booth''s daily stats'
);
reset role;
select tests.login(:'walker_id');
select is_empty(
  format($$select 1 from public.booth_stats_daily where booth_id = %L$$, :'booth_id'),
  'someone else cannot'
);
reset role;

select ok(public.record_try_click(:'booth_id'), 'a try click on a live booth is counted');
select is(
  (select try_clicks from public.booth_stats_daily
   where booth_id = :'booth_id' and day = (now() at time zone 'utc')::date), 2,
  'it adds to today''s row'
);
select ok(not public.record_try_click(:'pending_id'), 'a booth that is not live counts nothing');

-- Tiers ----------------------------------------------------------------------------------------------

-- Eleven busy booths (weekly 1100 … 1000), far above the seeded city's (at most 308), plus edge cases.
create temp table tier_fixture (n int, id uuid);
insert into tier_fixture
select n, tests.create_booth(:'owner_id', 'tier-top-' || n) from generate_series(1, 11) as n;
insert into public.booth_stats_daily (booth_id, day, unique_visitors)
select id, (now() at time zone 'utc')::date - 1, 1110 - n * 10 from tier_fixture;

select tests.create_booth(:'owner_id', 'tier-veteran') as veteran_id \gset
select tests.create_booth(:'owner_id', 'tier-almost') as almost_id \gset
select tests.create_booth(:'owner_id', 'tier-fresh-pavilion') as fresh_id \gset
select tests.create_booth(:'owner_id', 'tier-old-pavilion') as old_id \gset
insert into public.booth_stats_daily (booth_id, day, unique_visitors) values
  (:'veteran_id', (now() at time zone 'utc')::date - 30, 200),
  (:'veteran_id', (now() at time zone 'utc')::date - 20, 50),
  (:'almost_id', (now() at time zone 'utc')::date - 30, 249),
  (:'old_id', (now() at time zone 'utc')::date - 30, 260);
update public.booths set tier = 'pavilion', tier_upgraded_at = now() - interval '2 days' where id = :'fresh_id';
update public.booths set tier = 'pavilion', tier_upgraded_at = now() - interval '10 days' where id = :'old_id';
update public.booths set tier = 'booth' where id = :'almost_id';

create temp table tier_run as select * from public.recompute_booth_tiers();

select is(
  (select count(*)::int from public.booths where id in (select id from tier_fixture where n <= 10) and tier = 'pavilion'),
  10, 'the top 10 by weekly visitors become pavilions'
);
select is(
  (select tier from public.booths where id = (select id from tier_fixture where n = 11)), 'booth'::public.booth_tier,
  'the 11th is not a pavilion (but has 1000 visitors, so a booth)'
);
select is((select tier from public.booths where id = :'veteran_id'), 'booth'::public.booth_tier, '250 visitors in total earn booth');
select is((select tier from public.booths where id = :'almost_id'), 'stall'::public.booth_tier, '249 visitors are a stall (downgraded: no recent upgrade)');
select is((select tier from public.booths where id = :'fresh_id'), 'pavilion'::public.booth_tier, 'no downgrade within 7 days of an upgrade');
select is((select tier from public.booths where id = :'old_id'), 'booth'::public.booth_tier, 'an upgrade 10 days ago can be downgraded');
select is((select tier from public.booths where id = :'booth_id'), 'stall'::public.booth_tier, 'a quiet booth stays a stall');
select ok(
  (select tier_upgraded_at > now() - interval '1 minute' from public.booths where id = :'veteran_id'),
  'an upgrade stamps tier_upgraded_at'
);
select is(
  (select new_tier from tier_run where booth_id = :'veteran_id'), 'booth'::public.booth_tier,
  'the function returns the changes'
);
select ok(
  not exists (select 1 from tier_run where booth_id = :'fresh_id'),
  'unchanged booths are not returned'
);
select is(
  (select detail from public.moderation_log where action = 'tier_change' and target_id = :'veteran_id'::text),
  '{"from": "stall", "to": "booth", "visitors": 250, "weeklyVisitors": 0}'::jsonb,
  'each change is logged with its numbers'
);
select ok(
  (select bool_and(actor_id is null and actor_handle = 'system') from public.moderation_log where action = 'tier_change'),
  'tier changes are logged by system'
);
select is_empty('select * from public.recompute_booth_tiers()', 'a second run changes nothing');

-- Wardrobe unlocks ---------------------------------------------------------------------------------

select tests.login(:'walker_id');
select throws_ok(
  $$update public.profiles set avatar_style = '{"accessory": {"item": "backpack", "color": 1}}' where id = auth.uid()$$,
  '23514', 'avatar item backpack is locked', 'a locked item is refused'
);
reset role;
insert into public.passport_stamps (user_id, stamp)
select :'walker_id', 'district:' || slug from public.districts
on conflict do nothing;
select tests.login(:'walker_id');
select lives_ok(
  $$update public.profiles set avatar_style = '{"accessory": {"item": "backpack", "color": 1}}' where id = auth.uid()$$,
  'every district stamped unlocks the backpack'
);
select throws_ok(
  $$update public.profiles set avatar_style = '{"accessory": {"item": "lanyard", "color": 1}}' where id = auth.uid()$$,
  '23514', 'avatar item lanyard is locked', 'the lanyard needs booths:50'
);
reset role;
update public.profiles set avatar_style = '{"accessory": {"item": "lanyard", "color": 1}}' where id = :'second_id';
select tests.login(:'second_id');
select lives_ok(
  $$update public.profiles set avatar_style = '{"accessory": {"item": "lanyard", "color": 2}}' where id = auth.uid()$$,
  'an item already worn can stay'
);
reset role;

select * from finish();
rollback;
