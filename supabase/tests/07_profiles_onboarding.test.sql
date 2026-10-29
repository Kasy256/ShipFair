begin;
\ir _helpers.psql
select plan(20);

select tests.create_user('alice') as alice_id \gset
select tests.create_user('bob') as bob_id \gset

-- Role -------------------------------------------------------------------------------------------
select tests.login(:'alice_id');
select throws_ok(
  format($$update public.profiles set role = 'admin' where id = %L$$, :'alice_id'),
  '42501', null, 'a user cannot change their own role'
);
select lives_ok(
  format($$update public.profiles set handle = 'alice_dev', display_name = 'Alice', onboarded_at = now() where id = %L$$, :'alice_id'),
  'a user can set their handle, display name and onboarded_at'
);
select is(
  (select onboarded_at is not null from public.profiles where id = :'alice_id'), true,
  'onboarded_at is readable by its owner'
);
update public.profiles set display_name = 'Hacked' where id = :'bob_id';
reset role;
select is(
  (select display_name from public.profiles where id = :'bob_id'), 'Bob',
  'a user cannot update someone else''s profile'
);
select is((select role from public.profiles where id = :'alice_id'), 'user', 'role is unchanged');

-- Case-insensitive handles -----------------------------------------------------------------------
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'profiles'
      and indexdef ilike 'create unique index%(lower(handle))%'
  ),
  'profiles has a unique index on lower(handle)'
);
select throws_ok(
  format($$update public.profiles set handle = 'alice_dev' where id = %L$$, :'bob_id'),
  '23505', null, 'a taken handle is refused'
);

-- handle_available -------------------------------------------------------------------------------
select tests.login(:'bob_id');
select is(public.handle_available('free_name'), true, 'a free handle is available');
select is(public.handle_available('alice_dev'), false, 'a taken handle is not available');
select is(public.handle_available('ALICE_DEV'), false, 'availability ignores case');
select is(public.handle_available('bob'), true, 'your own handle counts as available');
select is(public.handle_available('ab'), false, 'too short is not available');
select is(public.handle_available('has-dash'), false, 'invalid characters are not available');
select is(public.handle_available('shit_lord'), false, 'a profane handle is not available');
select tests.logout_anon();
select throws_ok($$select public.handle_available('anything')$$, '42501', null, 'anon cannot probe handles');

-- Name filter ------------------------------------------------------------------------------------
select tests.login(:'bob_id');
select throws_ok(
  format($$update public.profiles set display_name = 'Big Fucker' where id = %L$$, :'bob_id'),
  '23514', null, 'a profane display name is refused'
);
select throws_ok(
  format($$update public.profiles set handle = 'fuck_off' where id = %L$$, :'bob_id'),
  '23514', null, 'a profane handle is refused'
);
select lives_ok(
  format($$update public.profiles set display_name = 'Scunthorpe Fan' where id = %L$$, :'bob_id'),
  'allowed words that contain blocked ones still pass'
);
reset role;

-- A profane OAuth name doesn't block signup; it becomes "Maker".
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'rude@test.local', '{"full_name": "Shit Head"}');
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-0000000000f1'), 'Maker',
  'a profane display name from OAuth becomes Maker'
);
select is(
  (select handle ~ '^maker_[a-z0-9]{6}$' and onboarded_at is null from public.profiles where id = '00000000-0000-4000-8000-0000000000f1'),
  true,
  'new users start with a generated handle and no onboarded_at'
);

select * from finish();
rollback;
