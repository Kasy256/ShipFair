-- Service-role functions behind the web Worker's realtime RPC (prompt 10, ARCHITECTURE.md §6):
-- `getPlayer` on every `hello` and `ingestStats` once a minute per shard.

-- The profile a shard shows for a signed-in player, plus their ban status read fresh (bans and
-- banned identities, through is_not_banned). One round trip per `hello`. `with_profile = false`
-- skips the profile for shards that still hold it in their 5-minute cache; the ban is always read.
create function public.realtime_player(uid uuid, with_profile boolean default true)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'id', p.id,
        'handle', p.handle,
        'displayName', p.display_name,
        'avatarStyle', p.avatar_style,
        'createdAt', p.created_at
      )
      from public.profiles as p
      where with_profile and p.id = uid
    ),
    'banned', not public.is_not_banned(uid)
  );
$$;

revoke execute on function public.realtime_player(uuid, boolean) from public, anon, authenticated;
grant execute on function public.realtime_player(uuid, boolean) to service_role;

-- Adds one shard's visit counts to booth_stats_daily in a single statement. `stats` is a jsonb
-- array of { boothId, day, visits, uniqueVisitors } (zod-checked by the Worker first). Rows for
-- booths that no longer exist are skipped, so a deleted booth can't fail the whole batch.
-- Returns the number of booth-days written.
create function public.ingest_booth_stats(stats jsonb)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with incoming as (
    select
      (e ->> 'boothId')::uuid as booth_id,
      (e ->> 'day')::date as day,
      greatest((e ->> 'visits')::int, 0) as visits,
      greatest((e ->> 'uniqueVisitors')::int, 0) as unique_visitors
    from jsonb_array_elements(coalesce(stats, '[]'::jsonb)) as e
  ),
  totals as (
    select i.booth_id, i.day, sum(i.visits)::int as visits, sum(i.unique_visitors)::int as unique_visitors
    from incoming as i
    join public.booths as b on b.id = i.booth_id
    group by i.booth_id, i.day
  ),
  written as (
    insert into public.booth_stats_daily as s (booth_id, day, visits, unique_visitors)
    select booth_id, day, visits, unique_visitors from totals
    on conflict (booth_id, day) do update
      set visits = s.visits + excluded.visits,
          unique_visitors = s.unique_visitors + excluded.unique_visitors
    returning 1
  )
  select count(*)::int from written;
$$;

revoke execute on function public.ingest_booth_stats(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_booth_stats(jsonb) to service_role;
