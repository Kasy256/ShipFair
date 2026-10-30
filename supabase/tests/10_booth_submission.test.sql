begin;
\ir _helpers.psql
select plan(17);

select tests.create_user('slugger') as owner_id \gset
select tests.create_user('rival') as rival_id \gset
select tests.create_booth(:'rival_id', 'taken-name') as rival_live \gset
select tests.create_booth(:'rival_id', 'taken-draft', 'draft') as rival_draft \gset

-- Slugs ------------------------------------------------------------------------------------------
select tests.login(:'owner_id');

insert into public.booths (owner_id, slug, name, tagline, url, district_id)
values (:'owner_id', 'taken-name', 'Taken Name', 'Collides with a live booth', 'https://example.com', 1);
select is(
  (select slug from public.booths where owner_id = :'owner_id' and name = 'Taken Name'), 'taken-name-2',
  'a slug a live booth has gets -2'
);

insert into public.booths (owner_id, slug, name, tagline, url, district_id)
values (:'owner_id', 'taken-draft', 'Taken Draft', 'Collides with someone else''s draft', 'https://example.com', 1);
select is(
  (select slug from public.booths where owner_id = :'owner_id' and name = 'Taken Draft'), 'taken-draft-2',
  'drafts the owner cannot see still count'
);

update public.booths set slug = 'taken-name' where owner_id = :'owner_id' and name = 'Taken Draft';
select is(
  (select slug from public.booths where owner_id = :'owner_id' and name = 'Taken Draft'), 'taken-name-3',
  'renaming onto a taken slug picks the next free suffix'
);

update public.booths set tagline = 'Only the tagline changed here' where owner_id = :'owner_id' and name = 'Taken Name';
select is(
  (select slug from public.booths where owner_id = :'owner_id' and name = 'Taken Name'), 'taken-name-2',
  'an update that does not touch the slug keeps it'
);

reset role;
insert into public.booths (owner_id, slug, name, tagline, url, district_id, status, approved_at)
values (:'rival_id', repeat('a', 40), 'Long', 'A booth with a 40 character slug', 'https://example.com', 1, 'approved', now());
select tests.login(:'owner_id');
insert into public.booths (owner_id, slug, name, tagline, url, district_id)
values (:'owner_id', repeat('a', 40), 'Long Too', 'Its suffix must still fit in 40', 'https://example.com', 1);
select is(
  (select slug from public.booths where owner_id = :'owner_id' and name = 'Long Too'), repeat('a', 38) || '-2',
  'a suffixed slug stays within 40 characters'
);

-- Booth cap (the owner has three now) -------------------------------------------------------------
select is((select count(*)::int from public.booths where owner_id = :'owner_id'), 3, 'three booths are allowed');

select throws_like(
  format(
    $$insert into public.booths (owner_id, slug, name, tagline, url, district_id)
      values (%L, 'fourth-one', 'Fourth', 'One booth too many for v1', 'https://example.com', 1)$$,
    :'owner_id'
  ),
  'booth limit%', 'a fourth booth is refused'
);

reset role;
update public.booths set status = 'archived' where owner_id = :'owner_id' and name = 'Long Too';
select tests.login(:'owner_id');
select lives_ok(
  format(
    $$insert into public.booths (owner_id, slug, name, tagline, url, district_id)
      values (%L, 'fourth-one', 'Fourth', 'Archived booths free a place', 'https://example.com', 1)$$,
    :'owner_id'
  ),
  'archived booths do not count'
);

-- Revisions --------------------------------------------------------------------------------------
reset role;
select tests.create_booth(:'owner_id', 'live-one') as live_id \gset
insert into public.booth_revisions (booth_id, owner_id, tagline, url, logo_key)
values (:'live_id', :'owner_id', 'A pending edit of the live booth', 'https://example.com/v2', 'u/' || :'owner_id' || '/logo.webp')
returning id as revision_id \gset

select throws_ok(
  format(
    $$insert into public.booth_revisions (booth_id, owner_id, tagline, url, logo_key)
      values (%L, %L, 'A second open edit is not allowed', 'https://example.com', 'u/' || %L || '/l.webp')$$,
    :'live_id', :'owner_id', :'owner_id'
  ),
  '23505', null, 'one open revision per booth'
);
select throws_ok(
  format(
    $$insert into public.booth_revisions (booth_id, owner_id, tagline, url, logo_key)
      values (%L, %L, 'Points at somebody else''s upload', 'https://example.com', 'u/' || %L || '/l.webp')$$,
    :'live_id', :'owner_id', :'rival_id'
  ),
  '23514', null, 'revision media must sit under the owner''s prefix'
);
update public.booth_revisions set status = 'approved' where id = :'revision_id';
select lives_ok(
  format(
    $$insert into public.booth_revisions (booth_id, owner_id, tagline, url, logo_key)
      values (%L, %L, 'A new edit after the last was decided', 'https://example.com', 'u/' || %L || '/l.webp')$$,
    :'live_id', :'owner_id', :'owner_id'
  ),
  'a decided revision does not block a new one'
);

select tests.login(:'owner_id');
select is(
  (select count(*)::int from public.booth_revisions where booth_id = :'live_id'), 2,
  'the owner reads their revisions'
);
select throws_ok(
  format(
    $$insert into public.booth_revisions (booth_id, owner_id, tagline, url, logo_key)
      values (%L, %L, 'Clients cannot write revisions', 'https://example.com', 'u/' || %L || '/l.webp')$$,
    :'live_id', :'owner_id', :'owner_id'
  ),
  '42501', null, 'owners cannot insert revisions directly'
);
select throws_ok(
  format($$update public.booth_revisions set status = 'approved' where booth_id = %L$$, :'live_id'),
  '42501', null, 'owners cannot approve their own revision'
);

select tests.login(:'rival_id');
select is(
  (select count(*)::int from public.booth_revisions), 0,
  'other users see no revisions'
);
select tests.logout_anon();
select is((select count(*)::int from public.booth_revisions), 0, 'anon sees no revisions');

-- Account deletion queues revision media ---------------------------------------------------------
reset role;
select is(
  public.delete_account(:'owner_id') >= 2, true,
  'delete_account queues the revision logos too'
);

select * from finish();
rollback;
