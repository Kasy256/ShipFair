begin;
\ir _helpers.psql
select plan(12);

select tests.create_user('leaver') as leaver_id \gset
select tests.create_user('stayer') as stayer_id \gset

insert into public.booths (owner_id, slug, name, tagline, url, district_id, status, approved_at, logo_key, media)
values (
  :'leaver_id', 'leaver-booth', 'Leaver', 'A booth that goes away with its owner', 'https://example.com', 1,
  'approved', now(), 'u/' || :'leaver_id' || '/logo.webp',
  jsonb_build_array(
    jsonb_build_object('type', 'image', 'key', 'u/' || :'leaver_id' || '/shot1.webp', 'w', 10, 'h', 10),
    jsonb_build_object('type', 'image', 'key', 'u/' || :'leaver_id' || '/shot2.webp', 'w', 10, 'h', 10)
  )
);
select tests.create_booth(:'stayer_id', 'stayer-booth') as stayer_booth \gset

-- Clients can't touch the queue or call delete_account -------------------------------------------
select tests.login(:'leaver_id');
select throws_ok($$select * from public.pending_media_deletes$$, '42501', null, 'users cannot read the media queue');
select throws_ok(
  $$insert into public.pending_media_deletes (key) values ('u/x/y.webp')$$,
  '42501', null, 'users cannot write to the media queue'
);
select throws_ok(
  format($$select public.delete_account(%L)$$, :'leaver_id'),
  '42501', null, 'users cannot call delete_account directly'
);
select tests.logout_anon();
select throws_ok(
  format($$select public.delete_account(%L)$$, :'leaver_id'),
  '42501', null, 'anon cannot call delete_account'
);
reset role;

-- The service role deletes the account and queues its media --------------------------------------
set local role service_role;
select is(public.delete_account(:'leaver_id'), 3, 'delete_account queues the logo and both screenshots');
select is(
  (select array_agg(key order by key) from public.pending_media_deletes),
  array['u/' || :'leaver_id' || '/logo.webp', 'u/' || :'leaver_id' || '/shot1.webp', 'u/' || :'leaver_id' || '/shot2.webp'],
  'the queued keys are the booth media'
);
select ok(
  (select bool_and(purge_after between now() + interval '29 days' and now() + interval '31 days') from public.pending_media_deletes),
  'media is purged after 30 days'
);
select throws_ok(
  format($$select public.delete_account(%L)$$, :'leaver_id'),
  'P0002', null, 'deleting a missing account fails'
);
reset role;

select is((select count(*)::int from auth.users where id = :'leaver_id'), 0, 'the auth user is gone');
select is((select count(*)::int from public.profiles where id = :'leaver_id'), 0, 'the profile cascades');
select is((select count(*)::int from public.booths where owner_id = :'leaver_id'), 0, 'the booths cascade');
select is((select count(*)::int from public.booths where id = :'stayer_booth'), 1, 'other users keep their booths');

select * from finish();
rollback;
