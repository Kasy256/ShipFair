begin;
\ir _helpers.psql
select plan(21);

-- signup trigger -------------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'oauth@test.local',
  '{"full_name": "  Ada Lovelace  "}'::jsonb);
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'bare@test.local', '{}'::jsonb);

select matches(
  (select handle from public.profiles where id = '10000000-0000-4000-8000-000000000001'),
  '^maker_[a-z0-9]{6}$',
  'signup creates a profile with a maker_xxxxxx handle'
);
select is(
  (select display_name from public.profiles where id = '10000000-0000-4000-8000-000000000001'), 'Ada Lovelace',
  'the display name comes from the OAuth metadata'
);
select is(
  (select display_name from public.profiles where id = '10000000-0000-4000-8000-000000000002'), 'Maker',
  'the display name falls back to Maker'
);

select tests.create_user('myself') as me_id \gset
select tests.create_user('yours') as you_id \gset
select tests.create_user('boss', 'admin') as admin_id \gset
select tests.create_booth(:'you_id', 'vote-me') as booth_id \gset
select tests.create_booth(:'you_id', 'vote-draft', 'draft') as draft_id \gset
insert into public.passport_stamps (user_id, stamp) values (:'me_id', 'district:ai-agents'), (:'you_id', 'district:dev-tools');
insert into public.booth_stats_daily (booth_id, day, visits) values (:'booth_id', current_date, 3);
insert into public.moderation_log (action, target_type, target_id) values ('approve', 'booth', :'booth_id');
insert into public.bans (user_id, reason, until) values (:'you_id', 'expired', now() - interval '1 hour');
insert into public.banned_identities (identity_hash, reason) values (repeat('a', 64), 'test');

-- profiles -------------------------------------------------------------------------------------
select tests.logout_anon();
select is(
  (select handle from public.public_profiles where id = :'me_id'), 'myself',
  'anon can read public profiles'
);
select throws_ok(
  'select role from public.profiles', '42501', null,
  'role is not readable by clients'
);

select tests.login(:'me_id');
select lives_ok(
  $$update public.profiles set display_name = 'Me Myself', links = '{"github": "me"}' where id = (select auth.uid())$$,
  'a user can update their own profile'
);
select throws_ok(
  $$update public.profiles set role = 'admin' where id = (select auth.uid())$$,
  '42501', null, 'a user cannot change their role'
);
update public.profiles set display_name = 'Hacked' where id = :'you_id';
select is(
  (select display_name from public.public_profiles where id = :'you_id'), 'Yours',
  'a user cannot update someone else''s profile'
);

-- votes ----------------------------------------------------------------------------------------
select lives_ok(
  format($$insert into public.booth_votes (booth_id, user_id) values (%L, %L)$$, :'booth_id', :'me_id'),
  'a user can vote for a live booth'
);
select throws_ok(
  format($$insert into public.booth_votes (booth_id, user_id) values (%L, %L)$$, :'booth_id', :'you_id'),
  '42501', null, 'a user cannot vote as someone else'
);
select throws_ok(
  format($$insert into public.booth_votes (booth_id, user_id) values (%L, %L)$$, :'draft_id', :'me_id'),
  '42501', null, 'a user cannot vote for a booth that is not live'
);

select tests.login(:'you_id');
insert into public.booth_votes (booth_id, user_id) values (:'booth_id', :'you_id');
select is(
  (select count(*)::int from public.booth_votes), 1,
  'a user sees only their own votes'
);
select tests.logout_anon();
select is(
  (select votes from public.booth_vote_counts where booth_id = :'booth_id'), 2,
  'booth_vote_counts totals every vote'
);
select tests.login(:'you_id');
delete from public.booth_votes where booth_id = :'booth_id';
reset role;
select is(
  (select count(*)::int from public.booth_votes where booth_id = :'booth_id'), 1,
  'a user can remove only their own vote'
);

-- private tables -------------------------------------------------------------------------------
select tests.login(:'me_id');
select is(
  (select array_agg(stamp) from public.passport_stamps), array['district:ai-agents'],
  'a user reads only their own stamps'
);
select is((select count(*)::int from public.booth_stats_daily), 0, 'clients cannot read booth_stats_daily');
select is((select count(*)::int from public.moderation_log), 0, 'clients cannot read moderation_log');
select is((select count(*)::int from public.bans), 0, 'clients cannot read bans');
select is((select count(*)::int from public.banned_identities), 0, 'clients cannot read banned_identities');

-- helpers --------------------------------------------------------------------------------------
select is((select public.is_staff()), false, 'is_staff() is false for a regular user');
select tests.login(:'admin_id');
select is((select public.is_staff()), true, 'is_staff() is true for an admin');

select * from finish();
rollback;
