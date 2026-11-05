begin;
\ir _helpers.psql
select plan(16);

select tests.create_user('reporter') as reporter_id \gset
select tests.create_user('owner') as owner_id \gset
select tests.create_booth(:'owner_id', 'stats-booth') as booth_id \gset

-- The jobs look at whole tables; start them empty (rolled back with the test).
delete from public.pending_media_deletes;
delete from public.booth_stats_daily;

-- Media queue: two due (queued over 30 days ago), one still kept --------------------------------
insert into public.pending_media_deletes (key, purge_after, created_at) values
  ('u/a/old1.webp', now() - interval '2 days', now() - interval '32 days'),
  ('u/a/old2.webp', now() - interval '1 hour', now() - interval '30 days 1 hour'),
  ('u/a/new.webp', now() + interval '29 days', now() - interval '1 day');

-- Reports: one old with chat context, one recent ---------------------------------------------------
insert into public.reports (reporter_id, target_type, target_id, reason, context, created_at) values
  (:'reporter_id', 'chat', :'owner_id', 'spam', '[{"text":"old line","ts":1}]', now() - interval '31 days'),
  (:'reporter_id', 'user', :'owner_id', 'spam', '[{"text":"new line","ts":2}]', now() - interval '2 days');

-- Clients can call none of the jobs ---------------------------------------------------------------
select tests.login(:'reporter_id');
select throws_ok($$select * from public.due_media_deletes(10)$$, '42501', null, 'users cannot list due media');
select throws_ok($$select public.finish_media_deletes('{1}')$$, '42501', null, 'users cannot drop queue rows');
select throws_ok($$select public.purge_report_context(30)$$, '42501', null, 'users cannot purge report context');
select throws_ok($$select public.booth_stats_sanity(null)$$, '42501', null, 'users cannot run the stats check');
select tests.logout_anon();
select throws_ok($$select * from public.due_media_deletes(10)$$, '42501', null, 'anon cannot list due media');
reset role;

set local role service_role;

-- R2 cleanup ---------------------------------------------------------------------------------------
select is(
  (select array_agg(key order by key) from public.due_media_deletes(10)),
  array['u/a/old1.webp', 'u/a/old2.webp'],
  'only keys past purge_after are due'
);
select is((select count(*)::int from public.due_media_deletes(1)), 1, 'max_rows limits the batch');
select is(
  public.finish_media_deletes((select array_agg(id) from public.pending_media_deletes)),
  2,
  'finish_media_deletes removes due rows only, even when handed every id'
);
select is(
  (select array_agg(key) from public.pending_media_deletes),
  array['u/a/new.webp'],
  'media inside its 30 days stays queued'
);

-- Report context purge -----------------------------------------------------------------------------
select is(public.purge_report_context(30), 1, 'one report is older than 30 days');
select is(
  (select count(*)::int from public.reports where reporter_id = :'reporter_id' and context is not null),
  1,
  'the recent report keeps its chat lines'
);
select is(
  (select count(*)::int from public.reports where reporter_id = :'reporter_id'),
  2,
  'purged reports themselves stay for the moderation history'
);
select is(public.purge_report_context(30), 0, 'a second run finds nothing');

-- Stats sanity -------------------------------------------------------------------------------------
reset role;
insert into public.booth_stats_daily (booth_id, day, visits, unique_visitors, try_clicks) values
  (:'booth_id', current_date - 2, 10, 4, 1),
  (:'booth_id', current_date - 3, 5, 9, 0);
set local role service_role;
select is(
  public.booth_stats_sanity(current_date - 1) - 'day',
  '{"rows":0,"visits":0,"tryClicks":0,"uniqueOverVisits":1,"futureRows":0,"gap":true}'::jsonb,
  'an empty day after a busy one is a gap, and impossible unique counts are found'
);
reset role;
insert into public.booth_stats_daily (booth_id, day, visits, unique_visitors, try_clicks)
values (:'booth_id', current_date - 1, 7, 3, 2);
set local role service_role;
select is(
  public.booth_stats_sanity(current_date - 1) ->> 'gap',
  'false',
  'rows for the day clear the gap'
);
select is(
  (public.booth_stats_sanity(current_date - 1) ->> 'visits')::int,
  7,
  'yesterday''s visits are summed'
);
reset role;

select * from finish();
rollback;
