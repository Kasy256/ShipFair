-- Pavilions need at least 25 unique visitors in the week, not just a top-10 place: early on, a
-- quiet fair would otherwise make near-empty booths pavilions. Everything else is as in
-- 20261101000200_passport_and_tiers.sql: top 10 by weekly unique visitors (now with at least 25)
-- → pavilion; otherwise 250 in total → booth; otherwise stall; no downgrade within 7 days of an
-- upgrade; changes logged as `tier_change` by `system`.
create or replace function public.recompute_booth_tiers()
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
        when t.weekly >= 25
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
