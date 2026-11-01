begin;
\ir _helpers.psql
select plan(26);

select tests.create_user('owner') as owner_id \gset
select tests.create_user('writer') as writer_id \gset
select tests.create_user('voter') as voter_id \gset
select tests.create_booth(:'owner_id', 'social-live') as booth_id \gset
select tests.create_booth(:'owner_id', 'social-other') as other_booth_id \gset
select tests.create_booth(:'writer_id', 'writer-booth') as writer_booth_id \gset

-- Guestbook filter -------------------------------------------------------------------------------

select is(public.censor_profanity('what the fuck'), 'what the ★★★★', 'a flagged word becomes stars');
select is(public.censor_profanity('Great   app,  love it'), 'Great app, love it', 'clean text is only normalised');
select is(public.censor_profanity(E'nice​ work­!'), 'nice work!', 'invisible characters are removed');
select is(public.censor_profanity('shit happens'), '★★★★ happens', 'only the flagged word is starred');

select tests.login(:'writer_id');
insert into public.guestbook_entries (booth_id, author_id, body)
values (:'booth_id', :'writer_id', 'this is fucking great') returning id as filtered_id \gset
select is(
  (select body from public.guestbook_entries where id = :filtered_id), 'this is ★★★★★★★ great',
  'the trigger stores the censored text'
);
insert into public.guestbook_entries (booth_id, author_id, body)
values (:'booth_id', :'writer_id', 'Lovely booth') returning id as clean_id \gset
select is(
  (select body from public.guestbook_entries where id = :clean_id), 'Lovely booth',
  'a clean entry is stored as written'
);
select throws_ok(
  format($$insert into public.guestbook_entries (booth_id, author_id, body) values (%L, %L, 'double penetration')$$, :'booth_id', :'writer_id'),
  '23514', 'guestbook entry has words that are not allowed',
  'a phrase that only matches across words is refused'
);
select throws_ok(
  format($$insert into public.guestbook_entries (booth_id, author_id, body) values (%L, %L, E'​ ')$$, :'booth_id', :'writer_id'),
  '23514', null, 'an entry that is empty after normalising is refused'
);
select is(
  (select author_handle || ': ' || body from public.guestbook_public where id = :clean_id),
  'writer: Lovely booth', 'guestbook_public shows the author handle'
);

-- Owner hide --------------------------------------------------------------------------------------

select tests.login(:'writer_id');
update public.guestbook_entries set hidden = true where id = :clean_id;
select tests.login(:'owner_id');
select is(
  (select count(*)::int from public.guestbook_entries where id = :clean_id), 1,
  'a writer cannot hide an entry on a booth they do not own'
);
select throws_ok(
  format($$update public.guestbook_entries set body = 'edited' where id = %s$$, :clean_id),
  '42501', null, 'an owner cannot edit the text of an entry'
);
select lives_ok(
  format($$update public.guestbook_entries set hidden = true where id = %s$$, :clean_id),
  'an owner can hide an entry on their own booth'
);
select tests.logout_anon();
select is(
  (select count(*)::int from public.guestbook_public where id = :clean_id), 0,
  'a hidden entry is gone from the public list'
);
reset role;
select is(
  (select hidden from public.guestbook_entries where id = :clean_id), true,
  'the entry is stored as hidden'
);
select tests.login(:'owner_id');
update public.guestbook_entries set hidden = false where id = :clean_id;
reset role;
select is(
  (select hidden from public.guestbook_entries where id = :clean_id), true,
  'an owner cannot unhide an entry (staff can)'
);
-- An entry on a booth the owner doesn't own.
select tests.login(:'owner_id');
insert into public.guestbook_entries (booth_id, author_id, body)
values (:'writer_booth_id', :'owner_id', 'Nice one') returning id as foreign_id \gset
update public.guestbook_entries set hidden = true where id = :foreign_id;
reset role;
select is(
  (select hidden from public.guestbook_entries where id = :foreign_id), false,
  'an owner cannot hide entries on other booths'
);

-- Votes -------------------------------------------------------------------------------------------

select tests.login(:'voter_id');
select lives_ok(
  format($$insert into public.booth_votes (booth_id, user_id) values (%L, %L)$$, :'booth_id', :'voter_id'),
  'a user can upvote a booth'
);
select throws_ok(
  format($$insert into public.booth_votes (booth_id, user_id) values (%L, %L)$$, :'booth_id', :'voter_id'),
  '23505', null, 'a second upvote on the same booth is refused'
);
select tests.login(:'writer_id');
insert into public.booth_votes (booth_id, user_id) values (:'booth_id', :'writer_id');
select tests.logout_anon();
select is(
  (select votes from public.booth_vote_counts where booth_id = :'booth_id'), 2,
  'booth_vote_counts counts one vote per user'
);
select tests.login(:'voter_id');
delete from public.booth_votes where booth_id = :'booth_id';
select tests.logout_anon();
select is(
  (select votes from public.booth_vote_counts where booth_id = :'booth_id'), 1,
  'removing your vote lowers the count, and only yours goes'
);

-- Report context ----------------------------------------------------------------------------------

select tests.login(:'voter_id');
select lives_ok(
  format(
    $$insert into public.reports (reporter_id, target_type, target_id, reason, context)
      values (%L, 'user', %L, 'hate', '[{"text": "hi", "ts": 1793000000000}]')$$,
    :'voter_id', :'writer_id'
  ),
  'a user report can carry chat lines'
);
select lives_ok(
  format(
    $$insert into public.reports (reporter_id, target_type, target_id, reason, context)
      select %L, 'user', %L, 'spam', jsonb_agg(jsonb_build_object('text', 'line ' || i, 'ts', i))
      from generate_series(1, 20) as i$$,
    :'voter_id', :'owner_id'
  ),
  'twenty lines are allowed'
);
reset role;
delete from public.reports where target_id = :'owner_id';
select tests.login(:'voter_id');
select throws_ok(
  format(
    $$insert into public.reports (reporter_id, target_type, target_id, reason, context)
      select %L, 'user', %L, 'spam', jsonb_agg(jsonb_build_object('text', 'line ' || i, 'ts', i))
      from generate_series(1, 21) as i$$,
    :'voter_id', :'owner_id'
  ),
  '23514', null, 'twenty-one lines are refused'
);
select throws_ok(
  format(
    $$insert into public.reports (reporter_id, target_type, target_id, reason, context)
      values (%L, 'user', %L, 'spam', '[{"text": "hi", "ts": 1, "extra": true}]')$$,
    :'voter_id', :'owner_id'
  ),
  '23514', null, 'a line with other fields is refused'
);
select throws_ok(
  format(
    $$insert into public.reports (reporter_id, target_type, target_id, reason, context)
      values (%L, 'booth', %L, 'spam', '[{"text": "hi", "ts": 1}]')$$,
    :'voter_id', :'booth_id'
  ),
  '23514', null, 'only user and chat reports carry chat lines'
);
select is(
  (select count(*)::int from public.reports where reporter_id = :'voter_id'), 0,
  'reporters cannot read reports (or their chat lines) back'
);

select * from finish();
rollback;
