begin;
\ir _helpers.psql
select plan(11);

select tests.create_user('owner') as owner_id \gset
select tests.create_user('writer') as writer_id \gset
select tests.create_user('banned') as banned_id \gset
select tests.create_user('exbanned') as exbanned_id \gset
select tests.create_user('bannedid') as banned_identity_id \gset

-- An active ban, an expired one, and a ban on the OAuth identity (survives account deletion).
insert into public.bans (user_id, reason) values (:'banned_id', 'test');
insert into public.bans (user_id, reason, until) values (:'exbanned_id', 'test', now() - interval '1 day');
insert into auth.identities (user_id, provider_id, provider, identity_data)
values (:'banned_identity_id', 'gh-42', 'github', '{}'::jsonb);
insert into public.banned_identities (identity_hash, reason)
values (encode(sha256(convert_to('github:gh-42', 'UTF8')), 'hex'), 'test');

select tests.create_booth(:'owner_id', 'guest-live') as booth_id \gset
select tests.create_booth(:'owner_id', 'guest-draft', 'draft') as draft_id \gset
insert into public.guestbook_entries (booth_id, author_id, body, hidden)
values (:'booth_id', :'owner_id', 'visible', false), (:'booth_id', :'owner_id', 'hidden one', true);

select tests.logout_anon();
select is(
  (select array_agg(body) from public.guestbook_entries where booth_id = :'booth_id'), array['visible'],
  'anon sees entries that are not hidden'
);
select throws_ok(
  format($$insert into public.guestbook_entries (booth_id, author_id, body) values (%L, %L, 'hi')$$, :'booth_id', :'writer_id'),
  '42501', null, 'anon cannot write to the guestbook'
);

select tests.login(:'writer_id');
select lives_ok(
  format($$insert into public.guestbook_entries (booth_id, author_id, body) values (%L, %L, 'entry 1')$$, :'booth_id', :'writer_id'),
  'a signed-in user can sign a guestbook'
);
select throws_ok(
  format($$insert into public.guestbook_entries (booth_id, author_id, body) values (%L, %L, 'forged')$$, :'booth_id', :'owner_id'),
  '42501', null, 'a user cannot sign as someone else'
);
select throws_ok(
  format($$insert into public.guestbook_entries (booth_id, author_id, body) values (%L, %L, 'early')$$, :'draft_id', :'writer_id'),
  '42501', null, 'a user cannot sign the guestbook of a booth that is not live'
);
select lives_ok(
  format(
    $$insert into public.guestbook_entries (booth_id, author_id, body)
      select %L, %L, 'entry ' || i from generate_series(2, 5) as i$$,
    :'booth_id', :'writer_id'
  ),
  'entries 2 to 5 in 10 minutes are allowed'
);
select throws_ok(
  format($$insert into public.guestbook_entries (booth_id, author_id, body) values (%L, %L, 'entry 6')$$, :'booth_id', :'writer_id'),
  'P0001', 'guestbook rate limit: 5 entries per 10 minutes', 'the 6th entry in 10 minutes is rate limited'
);

select tests.login(:'banned_id');
select throws_ok(
  format($$insert into public.guestbook_entries (booth_id, author_id, body) values (%L, %L, 'hi')$$, :'booth_id', :'banned_id'),
  '42501', null, 'a banned user cannot write to the guestbook'
);

select tests.login(:'banned_identity_id');
select throws_ok(
  format($$insert into public.guestbook_entries (booth_id, author_id, body) values (%L, %L, 'hi')$$, :'booth_id', :'banned_identity_id'),
  '42501', null, 'a user with a banned OAuth identity cannot write to the guestbook'
);

select tests.login(:'exbanned_id');
select lives_ok(
  format($$insert into public.guestbook_entries (booth_id, author_id, body) values (%L, %L, 'back again')$$, :'booth_id', :'exbanned_id'),
  'an expired ban no longer blocks writes'
);

-- Owners hide entries through the API for now (see the PR follow-ups), not by direct update.
select tests.login(:'owner_id');
update public.guestbook_entries set hidden = true where booth_id = :'booth_id';
select tests.logout_anon();
select is(
  (select count(*)::int from public.guestbook_entries where booth_id = :'booth_id'), 7,
  'clients cannot update guestbook entries'
);

select * from finish();
rollback;
