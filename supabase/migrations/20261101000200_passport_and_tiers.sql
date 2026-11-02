-- Prompt 13: passport stamps derived from evidence, booth visitor stats for visitors and owners,
-- try-click counts, the nightly tier job and wardrobe unlocks (ARCHITECTURE.md §4, §5, §7).

-- Passport stamps ------------------------------------------------------------------------------

-- The keys the app knows (StampKey in packages/shared/src/schemas/passport.ts). Only the service
-- role has ever written stamps, through the functions below.
alter table public.passport_stamps add constraint passport_stamps_key_valid check (
  stamp ~ '^(district:[a-z0-9-]{3,40}|booths:(1|10|50|100)|first:(upvote|note|chat)|met-a-maker|squad)$'
);

-- Stamps are public: /u/:handle shows them. They say where someone walked, not when or with whom.
drop policy passport_stamps_select_own on public.passport_stamps;
create policy passport_stamps_select_all on public.passport_stamps
  for select to anon, authenticated
  using (true);

-- What shards saw players do, sent with their stats batches (no per-message writes): districts
-- dwelled in for 10 s, booths visited (6 m, 5 s), and realtime-only facts. A player key is the
-- profile id or `guest:<guestId>`. Service role only.
create table public.passport_evidence (
  player_key text not null check (
    player_key ~ '^(guest:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  kind text not null check (kind in ('district', 'booth', 'fact')),
  key text not null check (char_length(key) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (player_key, kind, key)
);
alter table public.passport_evidence enable row level security;

-- A guest id merged into an account. Evidence a shard reports for that guest later (it reports
-- once a minute) goes to the account. One account per guest id. Service role only.
create table public.passport_guest_links (
  guest_key text primary key check (
    guest_key ~ '^guest:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  user_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);
create index passport_guest_links_user_id_idx on public.passport_guest_links (user_id);
alter table public.passport_guest_links enable row level security;

-- Every stamp the evidence and the user's own rows back. Nothing here trusts the browser.
create function public.passport_earned(uid uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select 'district:' || d.slug
  from public.passport_evidence as e
  join public.districts as d on d.slug = e.key
  where e.player_key = uid::text and e.kind = 'district'
  union all
  select 'booths:' || m
  from unnest(array[1, 10, 50, 100]) as m
  where (
    select count(*) from public.passport_evidence as e
    where e.player_key = uid::text and e.kind = 'booth'
  ) >= m
  union all
  select e.key
  from public.passport_evidence as e
  where e.player_key = uid::text and e.kind = 'fact' and e.key in ('met-a-maker', 'first:chat', 'squad')
  union all
  select 'first:upvote' where exists (select 1 from public.booth_votes as v where v.user_id = uid)
  union all
  select 'first:note'
  where exists (select 1 from public.guestbook_entries as g where g.author_id = uid);
$$;

-- Awards whatever the evidence backs (only `claims` when given) and returns the stamps among
-- `claims` (or all) the user holds afterwards. Banned users and unknown ids get nothing.
create function public.award_stamps(uid uuid, claims text[] default null)
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles as p where p.id = uid)
    or not public.is_not_banned(uid) then
    return '{}'::text[];
  end if;
  insert into public.passport_stamps (user_id, stamp)
  select uid, s from public.passport_earned(uid) as s
  where claims is null or s = any (claims)
  on conflict do nothing;
  return array(
    select p.stamp from public.passport_stamps as p
    where p.user_id = uid and (claims is null or p.stamp = any (claims))
    order by p.stamp
  );
end;
$$;

-- A guest's passport after signing in: links the guest id to the account (first account wins),
-- moves the guest's evidence over and awards what it backs. `pending` are claims not backed yet;
-- a shard's next batch can still back them through the link. Another account's guest id gets
-- nothing back, so the browser drops those stamps.
create function public.merge_guest_passport(uid uuid, guest uuid, claims text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  gkey text := 'guest:' || guest::text;
  owner uuid;
  held text[];
begin
  if not exists (select 1 from public.profiles as p where p.id = uid) then
    raise exception 'no profile for this user' using errcode = 'P0001', hint = 'not_found';
  end if;
  insert into public.passport_guest_links (guest_key, user_id) values (gkey, uid)
  on conflict (guest_key) do nothing;
  select l.user_id into owner from public.passport_guest_links as l where l.guest_key = gkey;
  if owner is distinct from uid then
    return jsonb_build_object('awarded', '[]'::jsonb, 'pending', '[]'::jsonb);
  end if;
  insert into public.passport_evidence (player_key, kind, key, created_at)
  select uid::text, e.kind, e.key, e.created_at
  from public.passport_evidence as e where e.player_key = gkey
  on conflict do nothing;
  delete from public.passport_evidence as e where e.player_key = gkey;
  held := public.award_stamps(uid, claims);
  return jsonb_build_object(
    'awarded', to_jsonb(array(select c from unnest(claims) as c where c = any (held))),
    'pending', to_jsonb(array(select c from unnest(claims) as c where not (c = any (held))))
  );
end;
$$;

-- A shard batch's evidence (zod-checked by the Worker first). Linked guests' rows go to their
-- account. Then every signed-in player in the batch is awarded what they now have, so stamps
-- arrive even if the browser never asks, except `squad`: the shard can only see that someone
-- joined a shard that wasn't empty, so that one also needs the browser's claim (it came through
-- a friend's `?with=` link). Returns the number of new evidence rows.
create function public.ingest_passport_evidence(evidence jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  written integer;
  players text[];
begin
  with incoming as (
    select distinct
      coalesce(l.user_id::text, e ->> 'player') as player_key,
      e ->> 'kind' as kind,
      e ->> 'key' as key
    from jsonb_array_elements(coalesce(evidence, '[]'::jsonb)) as e
    left join public.passport_guest_links as l on l.guest_key = e ->> 'player'
  )
  insert into public.passport_evidence (player_key, kind, key)
  select i.player_key, i.kind, i.key from incoming as i
  on conflict do nothing;
  get diagnostics written = row_count;

  select array_agg(distinct coalesce(l.user_id::text, e ->> 'player')) into players
  from jsonb_array_elements(coalesce(evidence, '[]'::jsonb)) as e
  left join public.passport_guest_links as l on l.guest_key = e ->> 'player';
  perform public.award_stamps(
    p.id, array(select s from public.passport_earned(p.id) as s where s <> 'squad')
  )
  from public.profiles as p
  where p.id::text = any (coalesce(players, '{}'));
  return written;
end;
$$;

-- Guest evidence nobody merged within 30 days is dropped by the nightly job.
create function public.prune_passport_evidence()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.passport_evidence as e
    where e.player_key like 'guest:%' and e.created_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke execute on function public.passport_earned(uuid) from public, anon, authenticated;
revoke execute on function public.award_stamps(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.merge_guest_passport(uuid, uuid, text[]) from public, anon, authenticated;
revoke execute on function public.ingest_passport_evidence(jsonb) from public, anon, authenticated;
revoke execute on function public.prune_passport_evidence() from public, anon, authenticated;
grant execute on function public.passport_earned(uuid) to service_role;
grant execute on function public.award_stamps(uuid, text[]) to service_role;
grant execute on function public.merge_guest_passport(uuid, uuid, text[]) to service_role;
grant execute on function public.ingest_passport_evidence(jsonb) to service_role;
grant execute on function public.prune_passport_evidence() to service_role;

-- Booth stats ------------------------------------------------------------------------------------

-- "N visitors this week" in the booth panel: unique visitors over the last 7 UTC days, approved
-- booths only. Runs with the owner's rights (like booth_vote_counts), so the daily table stays
-- private; the browser caches the answer.
create view public.booth_stats_week as
select s.booth_id, sum(s.unique_visitors)::int as visitors
from public.booth_stats_daily as s
join public.booths as b on b.id = s.booth_id and b.status = 'approved'
where s.day > (now() at time zone 'utc')::date - 7
group by s.booth_id;
grant select on public.booth_stats_week to anon, authenticated;

-- Owners read their own booths' daily rows (the chart on /me).
create policy booth_stats_daily_select_owner on public.booth_stats_daily
  for select to authenticated
  using (
    exists (
      select 1 from public.booths as b
      where b.id = booth_id and b.owner_id = (select auth.uid())
    )
  );

-- One "Try it" click (the Worker rate-limits per IP first). Approved booths only.
create function public.record_try_click(booth uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with live as (
    select b.id from public.booths as b where b.id = booth and b.status = 'approved'
  ),
  written as (
    insert into public.booth_stats_daily as s (booth_id, day, try_clicks)
    select live.id, (now() at time zone 'utc')::date, 1 from live
    on conflict (booth_id, day) do update set try_clicks = s.try_clicks + 1
    returning 1
  )
  select exists (select 1 from written);
$$;
revoke execute on function public.record_try_click(uuid) from public, anon, authenticated;
grant execute on function public.record_try_click(uuid) to service_role;

-- Booth tiers ------------------------------------------------------------------------------------

-- When the booth last moved up a tier: no downgrade for 7 days after.
alter table public.booths add column tier_upgraded_at timestamptz;

-- The nightly tier job (ARCHITECTURE.md §4), called by the web Worker's cron. For approved booths:
-- top 10 by unique visitors over the last 7 UTC days (more than 0) → pavilion; otherwise 250
-- unique visitors in total (sum of daily uniques) → booth; otherwise stall. A booth that moved up
-- within 7 days keeps its tier. Every change is logged as `tier_change` by `system`. Returns the
-- changed booths so the Worker can bump the world version and tell the shards.
create function public.recompute_booth_tiers()
returns table (booth_id uuid, old_tier public.booth_tier, new_tier public.booth_tier)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  -- Two overlapping runs (a retried cron) would log every change twice.
  perform pg_advisory_xact_lock(hashtext('recompute_booth_tiers'));
  return query
  with totals as (
    select
      b.id, b.tier, b.tier_upgraded_at, b.approved_at,
      coalesce(sum(s.unique_visitors), 0)::int as total,
      coalesce(sum(s.unique_visitors) filter (where s.day > today - 7), 0)::int as weekly
    from public.booths as b
    left join public.booth_stats_daily as s on s.booth_id = b.id
    where b.status = 'approved'
    group by b.id
  ),
  earned as (
    select t.*,
      case
        when t.weekly > 0
          and row_number() over (order by t.weekly desc, t.approved_at, t.id) <= 10
          then 'pavilion'
        when t.total >= 250 then 'booth'
        else 'stall'
      end::public.booth_tier as tier_earned
    from totals as t
  ),
  decided as (
    select e.id, e.tier as tier_before, e.total, e.weekly,
      case
        when e.tier_earned < e.tier and e.tier_upgraded_at > now() - interval '7 days' then e.tier
        else e.tier_earned
      end as tier_after
    from earned as e
  ),
  changed as (
    update public.booths as b
    set tier = d.tier_after,
        tier_upgraded_at = case when d.tier_after > d.tier_before then now() else b.tier_upgraded_at end
    from decided as d
    where b.id = d.id and d.tier_after <> d.tier_before
    returning b.id, d.tier_before, d.tier_after, d.total, d.weekly
  ),
  logged as (
    insert into public.moderation_log (actor_id, actor_handle, action, target_type, target_id, detail)
    select null, 'system', 'tier_change', 'booth', c.id::text, jsonb_build_object(
      'from', c.tier_before, 'to', c.tier_after, 'visitors', c.total, 'weeklyVisitors', c.weekly
    )
    from changed as c
    returning 1
  )
  select c.id, c.tier_before, c.tier_after from changed as c;
end;
$$;
revoke execute on function public.recompute_booth_tiers() from public, anon, authenticated;
grant execute on function public.recompute_booth_tiers() to service_role;

-- Wardrobe unlocks -------------------------------------------------------------------------------

-- Items with an `unlock` rule in art/config/wardrobe.json (UNLOCKS in shared; a shared test keeps
-- the two in step). Readable by everyone.
create table public.wardrobe_unlocks (
  item_id text primary key check (item_id ~ '^[a-z0-9_]{1,40}$'),
  rule text not null check (rule ~ '^stamp:[a-z0-9:-]{1,60}$')
);
alter table public.wardrobe_unlocks enable row level security;
create policy wardrobe_unlocks_select_all on public.wardrobe_unlocks
  for select to anon, authenticated
  using (true);
insert into public.wardrobe_unlocks (item_id, rule) values
  ('backpack', 'stamp:district:all'),
  ('lanyard', 'stamp:booths:50');

-- isUnlockMet() in SQL: `stamp:district:all` is a stamp for every district, `stamp:<key>` that stamp.
create function public.unlock_rule_met(uid uuid, rule text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when rule = 'stamp:district:all' then
      exists (select 1 from public.districts)
      and not exists (
        select 1 from public.districts as d
        where not exists (
          select 1 from public.passport_stamps as p
          where p.user_id = uid and p.stamp = 'district:' || d.slug
        )
      )
    when rule like 'stamp:%' then
      exists (
        select 1 from public.passport_stamps as p
        where p.user_id = uid and p.stamp = substr(rule, 7)
      )
    else false
  end;
$$;
-- The profile trigger runs as the signed-in user, so they may call it (stamps are public anyway).
revoke execute on function public.unlock_rule_met(uuid, text) from public, anon;
grant execute on function public.unlock_rule_met(uuid, text) to authenticated, service_role;

-- The item ids an AvatarStyle v2 wears.
create function public.avatar_items(style jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array(
    select style -> slot ->> 'item'
    from unnest(array['hair', 'facial', 'headwear', 'top', 'bottom', 'shoes', 'accessory']) as slot
    where jsonb_typeof(style -> slot) = 'object' and style -> slot ->> 'item' is not null
  );
$$;

-- A user can't put on a locked item they haven't earned (23514, hint 'locked_item'). Items they
-- already wear are left alone, and the service role is exempt.
create function public.profiles_guard_unlocks()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  worn text[];
  locked text;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  worn := public.avatar_items(old.avatar_style);
  select w.item_id into locked
  from unnest(public.avatar_items(new.avatar_style)) as item
  join public.wardrobe_unlocks as w on w.item_id = item
  where not (item = any (worn)) and not public.unlock_rule_met(new.id, w.rule)
  limit 1;
  if locked is not null then
    raise exception 'avatar item % is locked', locked using errcode = '23514', hint = 'locked_item';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_unlocks
  before update of avatar_style on public.profiles
  for each row execute function public.profiles_guard_unlocks();
