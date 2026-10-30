begin;
\ir _helpers.psql
select plan(34);

select tests.create_user('mod_one', 'moderator') as mod_id \gset
select tests.create_user('plain_user') as user_id \gset
select tests.create_user('troll') as troll_id \gset
select tests.create_booth(:'user_id', 'waiting-booth', 'pending') as pending_id \gset
select tests.create_booth(:'user_id', 'second-booth', 'pending') as pending2_id \gset
select tests.create_booth(:'user_id', 'live-booth') as live_id \gset

insert into auth.identities (id, user_id, provider_id, provider, identity_data)
values (gen_random_uuid(), :'troll_id', '777', 'github', '{"sub":"777"}');

-- Privileges -------------------------------------------------------------------------------------
select ok(
  has_function_privilege('service_role', 'public.admin_action(uuid, text, text, jsonb)', 'execute'),
  'the service role may call admin_action'
);
select ok(
  not has_function_privilege('authenticated', 'public.admin_action(uuid, text, text, jsonb)', 'execute'),
  'signed-in users may not call admin_action'
);
select ok(
  not has_function_privilege('anon', 'public.admin_action(uuid, text, text, jsonb)', 'execute'),
  'guests may not call admin_action'
);

select tests.login(:'mod_id');
select is_empty($$select * from public.flags$$, 'even staff cannot read flags directly (service role only)');
select throws_ok($$select * from public.admin_review_queue$$, '42501', null, 'users cannot read the queue view');
select throws_ok($$select * from public.admin_report_targets$$, '42501', null, 'users cannot read the report view');
reset role;

set local role service_role;

-- Flags ------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.flags where key in (
    'MIN_ACCOUNT_AGE_MINUTES', 'GUEST_CHAT', 'NEW_ACCOUNT_CHAT_MINUTES', 'SUBMISSIONS_OPEN'
  )),
  4, 'the four v1 flags exist'
);

-- Staff check ------------------------------------------------------------------------------------
select throws_ok(
  format($$select public.admin_action(%L, 'approve_booth', %L)$$, :'user_id', :'pending_id'),
  'P0001', 'only staff can moderate', 'a non-staff actor is refused'
);

-- Approve ----------------------------------------------------------------------------------------
select is(
  public.admin_action(:'mod_id', 'approve_booth', :'pending_id') ->> 'boothId', :'pending_id',
  'approve returns the booth id'
);
select is((select status::text from public.booths where id = :'pending_id'), 'approved', 'the booth is live');
select isnt((select approved_at from public.booths where id = :'pending_id'), null, 'approved_at is set');
select results_eq(
  format($$select actor_handle, action, target_type from public.moderation_log where target_id = %L$$, :'pending_id'),
  $$values ('mod_one'::text, 'approve'::text, 'booth'::text)$$,
  'approve writes the log with the actor handle'
);
select throws_like(
  format($$select public.admin_action(%L, 'approve_booth', %L)$$, :'mod_id', :'pending_id'),
  'booth is not pending', 'a booth that is already live cannot be approved twice'
);

-- Reject -----------------------------------------------------------------------------------------
select lives_ok(
  format(
    $$select public.admin_action(%L, 'reject_booth', %L, '{"reason":"broken_link","reasonText":"Broken link"}')$$,
    :'mod_id', :'pending2_id'
  ),
  'reject runs'
);
select results_eq(
  format($$select status::text, reject_reason from public.booths where id = %L$$, :'pending2_id'),
  $$values ('rejected'::text, 'Broken link'::text)$$,
  'the booth is rejected with the reason text'
);

-- Revisions --------------------------------------------------------------------------------------
insert into public.booth_revisions (booth_id, owner_id, tagline, url, logo_key)
values (:'live_id', :'user_id', 'The edited tagline after review', 'https://example.com/v2', 'u/' || :'user_id' || '/new.webp')
returning id as revision_id \gset
select is(
  public.admin_action(:'mod_id', 'approve_revision', :'revision_id') ->> 'boothId', :'live_id',
  'approving a revision returns its booth'
);
select results_eq(
  format($$select tagline, url, logo_key from public.booths where id = %L$$, :'live_id'),
  format($$values ('The edited tagline after review'::text, 'https://example.com/v2'::text, %L::text)$$, 'u/' || :'user_id' || '/new.webp'),
  'the revision is applied to the live booth'
);
select is(
  (select status::text from public.booth_revisions where id = :'revision_id'), 'approved',
  'the revision is marked approved'
);

insert into public.booth_revisions (booth_id, owner_id, tagline, url, logo_key)
values (:'live_id', :'user_id', 'A second edit staff will turn down', 'https://example.com/v3', 'u/' || :'user_id' || '/new.webp')
returning id as revision2_id \gset
select is(
  public.admin_action(:'mod_id', 'reject_revision', :'revision2_id', '{"reason":"nsfw","reasonText":"Not safe for work"}') ->> 'boothId',
  :'live_id', 'rejecting a revision returns its booth'
);
select results_eq(
  format($$select status::text, reject_reason, decided_at is not null from public.booth_revisions where id = %L$$, :'revision2_id'),
  $$values ('rejected'::text, 'Not safe for work'::text, true)$$,
  'the revision is rejected with the reason; the live booth keeps its content'
);
select is(
  (select tagline from public.booths where id = :'live_id'), 'The edited tagline after review',
  'a rejected revision leaves the booth as it was'
);

-- Hide -------------------------------------------------------------------------------------------
select lives_ok(
  format($$select public.admin_action(%L, 'hide_booth', %L, '{"hidden":true}')$$, :'mod_id', :'live_id'),
  'hide runs'
);
select is((select status::text from public.booths where id = :'live_id'), 'hidden', 'the booth is hidden');
select lives_ok(
  format($$select public.admin_action(%L, 'hide_booth', %L, '{"hidden":false}')$$, :'mod_id', :'live_id'),
  'unhide runs'
);
select is(
  (select array_agg(action order by id)::text from public.moderation_log
    where target_id = :'live_id' or detail ->> 'boothId' = :'live_id'),
  '{approve_revision,reject_revision,hide,unhide}', 'revision decisions, hide and unhide are logged against the booth'
);

-- Ban --------------------------------------------------------------------------------------------
select is(
  (public.admin_action(:'mod_id', 'ban', :'troll_id', '{"reason":"spam"}') ->> 'identities')::int, 1,
  'ban hashes each OAuth identity'
);
select ok(not public.is_not_banned(:'troll_id'), 'the user is banned');
select ok(
  exists (
    select 1 from public.banned_identities
    where identity_hash = encode(sha256(convert_to('github:777', 'UTF8')), 'hex')
  ),
  'the identity ban is kept apart from the account'
);
select throws_like(
  format($$select public.admin_action(%L, 'ban', %L, '{"reason":"nope"}')$$, :'mod_id', :'mod_id'),
  'staff accounts cannot be banned', 'staff cannot be banned'
);
select lives_ok(
  format($$select public.admin_action(%L, 'unban', %L)$$, :'mod_id', :'troll_id'),
  'unban runs'
);
select ok(public.is_not_banned(:'troll_id'), 'unban lifts both the account and identity ban');

-- Reports and flags ------------------------------------------------------------------------------
insert into public.reports (reporter_id, target_type, target_id, reason)
values (:'user_id', 'user', :'troll_id', 'spam')
returning id as report_id \gset
select lives_ok(
  format($$select public.admin_action(%L, 'report_status', %L, '{"status":"dismissed"}')$$, :'mod_id', :'report_id'),
  'report status runs'
);
select lives_ok(
  format($$select public.admin_action(%L, 'set_flag', 'SUBMISSIONS_OPEN', '{"value":false}')$$, :'mod_id'),
  'set_flag runs'
);
select results_eq(
  $$select value, updated_by from public.flags where key = 'SUBMISSIONS_OPEN'$$,
  format($$values ('false'::jsonb, %L::uuid)$$, :'mod_id'),
  'the flag is stored with who changed it'
);

reset role;
select * from finish();
rollback;
