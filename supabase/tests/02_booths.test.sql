begin;
\ir _helpers.psql
select plan(26);

select tests.create_user('owner') as owner_id \gset
select tests.create_user('other') as other_id \gset
select tests.create_user('banned') as banned_id \gset
insert into public.bans (user_id, reason) values (:'banned_id', 'test');

select tests.create_booth(:'owner_id', 'test-approved') as approved_id \gset
select tests.create_booth(:'owner_id', 'test-pending', 'pending') as pending_id \gset
select tests.create_booth(:'owner_id', 'test-hidden', 'hidden') as hidden_id \gset
-- Rejected after having been approved once, so approved_at is set and the slug is fixed.
select tests.create_booth(:'owner_id', 'test-was-live', 'rejected') as was_live_id \gset
update public.booths set approved_at = now() where id = :'was_live_id';
-- This owner already has 4 booths; the 3-booth cap (prompt 08) has its own tests in 10, so it is
-- off here (inside this transaction only) to keep these tests about the column guard and RLS.
alter table public.booths disable trigger booths_owner_limit;

-- anon -----------------------------------------------------------------------------------------
select tests.logout_anon();

select is(
  (select count(*)::int from public.booths where status <> 'approved'), 0,
  'anon sees only approved booths'
);
select is(
  (select count(*)::int from public.booths where id = :'approved_id'), 1,
  'anon sees an approved booth'
);
select is(
  (select count(*)::int from public.booths where id in (:'pending_id', :'hidden_id')), 0,
  'anon cannot see pending or hidden booths'
);
select throws_ok(
  $$insert into public.booths (owner_id, slug, name, tagline, url, district_id)
    values (gen_random_uuid(), 'anon-booth', 'Anon', 'Anonymous booth attempt', 'https://example.com', 1)$$,
  '42501', null, 'anon cannot insert booths'
);

-- owner ----------------------------------------------------------------------------------------
select tests.login(:'owner_id');

select is(
  (select count(*)::int from public.booths where id in (:'pending_id', :'hidden_id')), 2,
  'an owner sees their own booths in any status'
);

select lives_ok(
  format(
    $$insert into public.booths (owner_id, slug, name, tagline, url, district_id, media, logo_key)
      values (%L, 'my-draft', 'My Draft', 'A draft created by its owner', 'https://example.com', 2,
        jsonb_build_array(jsonb_build_object('type', 'image', 'key', 'u/' || %L || '/a.webp', 'w', 10, 'h', 10)),
        'u/' || %L || '/logo.webp')$$,
    :'owner_id', :'owner_id', :'owner_id'
  ),
  'an owner can create a draft'
);
select is(
  (select status::text from public.booths where slug = 'my-draft'), 'draft',
  'the new booth is a draft'
);
select lives_ok(
  $$update public.booths set tagline = 'An edited tagline for the draft', slug = 'my-draft-2' where slug = 'my-draft'$$,
  'an owner can edit their draft, slug included'
);
select is(
  (select tagline from public.booths where slug = 'my-draft-2'), 'An edited tagline for the draft',
  'the edit is saved'
);

select throws_ok(
  $$update public.booths set status = 'approved' where slug = 'my-draft-2'$$,
  '42501', null, 'an owner cannot set status = approved'
);
select throws_ok(
  $$update public.booths set tier = 'pavilion' where slug = 'my-draft-2'$$,
  '42501', null, 'an owner cannot change the tier'
);
select throws_ok(
  format($$update public.booths set owner_id = %L where slug = 'my-draft-2'$$, :'other_id'),
  '42501', null, 'an owner cannot give the booth away'
);
select throws_ok(
  $$update public.booths set approved_at = now(), reject_reason = 'x' where slug = 'my-draft-2'$$,
  '42501', null, 'an owner cannot set approved_at or reject_reason'
);
select throws_ok(
  format(
    $$insert into public.booths (owner_id, slug, name, tagline, url, district_id, status)
      values (%L, 'sneaky', 'Sneaky', 'Trying to skip the review queue', 'https://example.com', 1, 'approved')$$,
    :'owner_id'
  ),
  '42501', null, 'an owner cannot insert an approved booth'
);
select throws_ok(
  format(
    $$insert into public.booths (owner_id, slug, name, tagline, url, district_id, tier)
      values (%L, 'sneaky-tier', 'Sneaky', 'Trying to buy a bigger booth', 'https://example.com', 1, 'pavilion')$$,
    :'owner_id'
  ),
  '42501', null, 'an owner cannot insert a bigger tier'
);

select lives_ok(
  format($$update public.booths set name = 'Pending Edit' where id = %L$$, :'pending_id'),
  'an owner can edit a pending booth'
);
select is(
  (select status::text from public.booths where id = :'pending_id'), 'draft',
  'editing a pending booth sends it back to draft'
);

select throws_ok(
  format($$update public.booths set slug = 'new-slug' where id = %L$$, :'was_live_id'),
  '42501', null, 'the slug is fixed once a booth has been approved'
);

-- Approved booths change through booth revisions (prompt 08), not direct updates.
update public.booths set name = 'Live Edit' where id = :'approved_id';
select is(
  (select name from public.booths where id = :'approved_id'), 'Test-Approved',
  'an owner cannot edit an approved booth directly'
);

select throws_ok(
  format(
    $$insert into public.booths (owner_id, slug, name, tagline, url, district_id, logo_key)
      values (%L, 'stolen-logo', 'Stolen', 'Points at another user''s upload', 'https://example.com', 1, 'u/' || %L || '/logo.webp')$$,
    :'owner_id', :'other_id'
  ),
  '23514', null, 'logo_key must sit under the owner''s prefix'
);
select throws_ok(
  format(
    $$insert into public.booths (owner_id, slug, name, tagline, url, district_id, media)
      values (%L, 'too-much-media', 'Too Much', 'Six screenshots is one too many', 'https://example.com', 1,
        (select jsonb_agg(jsonb_build_object('type', 'image', 'key', 'u/' || %L || '/' || i || '.webp', 'w', 1, 'h', 1))
         from generate_series(1, 6) as i))$$,
    :'owner_id', :'owner_id'
  ),
  '23514', null, 'media holds at most 5 items'
);
select throws_ok(
  format(
    $$insert into public.booths (owner_id, slug, name, tagline, url, district_id, media)
      values (%L, 'dotdot', 'Dot Dot', 'Path traversal in a media key', 'https://example.com', 1,
        jsonb_build_array(jsonb_build_object('type', 'image', 'key', 'u/' || %L || '/../x.webp', 'w', 1, 'h', 1)))$$,
    :'owner_id', :'owner_id'
  ),
  '23514', null, 'media keys cannot contain ..'
);

-- another user ---------------------------------------------------------------------------------
select tests.login(:'other_id');

select is(
  (select count(*)::int from public.booths where owner_id = :'owner_id' and status <> 'approved'), 0,
  'another user cannot see someone else''s drafts'
);
update public.booths set name = 'Hijacked' where owner_id = :'owner_id';
select tests.login(:'owner_id');
select is(
  (select count(*)::int from public.booths where name = 'Hijacked'), 0,
  'another user cannot edit someone else''s booth'
);
select tests.login(:'other_id');
select throws_ok(
  format(
    $$insert into public.booths (owner_id, slug, name, tagline, url, district_id)
      values (%L, 'impostor', 'Impostor', 'A booth in someone else''s name', 'https://example.com', 1)$$,
    :'owner_id'
  ),
  '42501', null, 'another user cannot create a booth for someone else'
);

-- banned user ----------------------------------------------------------------------------------
select tests.login(:'banned_id');

select throws_ok(
  format(
    $$insert into public.booths (owner_id, slug, name, tagline, url, district_id)
      values (%L, 'banned-booth', 'Banned', 'A banned user trying to submit', 'https://example.com', 1)$$,
    :'banned_id'
  ),
  '42501', null, 'a banned user cannot create a booth'
);

select * from finish();
rollback;
