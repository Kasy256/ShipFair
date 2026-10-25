begin;
\ir _helpers.psql
select plan(13);

select tests.create_user('owner') as owner_id \gset
select tests.create_user('reporter1') as r1_id \gset
select tests.create_user('reporter2') as r2_id \gset
select tests.create_user('reporter3') as r3_id \gset
select tests.create_user('mod', 'moderator') as mod_id \gset

select tests.create_booth(:'owner_id', 'reported') as booth_id \gset
select tests.create_booth(:'owner_id', 'sock-target') as sock_booth_id \gset

-- reading and writing reports ------------------------------------------------------------------
select tests.logout_anon();
select throws_ok(
  format($$insert into public.reports (reporter_id, target_type, target_id, reason) values (null, 'booth', %L, 'spam')$$, :'booth_id'),
  '42501', null, 'anon cannot report'
);
select is((select count(*)::int from public.reports), 0, 'anon cannot read reports');

select tests.login(:'r1_id');
select lives_ok(
  format($$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'booth', %L, 'spam')$$, :'r1_id', :'booth_id'),
  'a user can report a booth'
);
select throws_ok(
  format($$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'booth', %L, 'spam')$$, :'r2_id', :'booth_id'),
  '42501', null, 'a user cannot report in someone else''s name'
);
select throws_ok(
  format($$insert into public.reports (reporter_id, target_type, target_id, reason, status) values (%L, 'user', %L, 'spam', 'dismissed')$$, :'r1_id', :'owner_id'),
  '42501', null, 'reports start open'
);
select is((select count(*)::int from public.reports), 0, 'a regular user cannot read reports, even their own');

select tests.login(:'mod_id');
select is((select count(*)::int from public.reports), 1, 'staff can read reports');

-- auto-hide ------------------------------------------------------------------------------------
select tests.login(:'r2_id');
insert into public.reports (reporter_id, target_type, target_id, reason) values (:'r2_id', 'booth', :'booth_id', 'scam');
select tests.logout_anon();
select is(
  (select count(*)::int from public.booths where id = :'booth_id'), 1,
  'two reports leave the booth live'
);

select tests.login(:'r3_id');
insert into public.reports (reporter_id, target_type, target_id, reason) values (:'r3_id', 'booth', :'booth_id', 'nsfw');
reset role;
select is(
  (select status::text from public.booths where id = :'booth_id'), 'hidden',
  'a third report from a distinct reporter hides the booth'
);
select is(
  (select detail from public.moderation_log where action = 'auto_hide' and target_id = :'booth_id'),
  '{"open_reports": 3}'::jsonb,
  'the auto-hide is logged as a system action'
);
select is(
  (select actor_id from public.moderation_log where action = 'auto_hide' and target_id = :'booth_id'),
  null,
  'the auto-hide has no actor'
);

-- One account can't hide a booth alone: a second open report on the same target is refused.
select tests.login(:'r1_id');
insert into public.reports (reporter_id, target_type, target_id, reason) values (:'r1_id', 'booth', :'sock_booth_id', 'spam');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_type, target_id, reason) values (%L, 'booth', %L, 'hate')$$, :'r1_id', :'sock_booth_id'),
  '23505', null, 'one reporter gets one open report per target'
);
reset role;
select is(
  (select status::text from public.booths where id = :'sock_booth_id'), 'approved',
  'repeat reports from one reporter do not hide a booth'
);

select * from finish();
rollback;
