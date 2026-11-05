-- Prompt 15: the web Worker's scheduled jobs (INFRASTRUCTURE.md §2 "Cron Triggers"). All of them
-- run as the service role; nothing here is callable by clients.

-- Media due for deletion (`purge_after` passed, i.e. queued 30+ days ago), oldest first. The
-- hourly job deletes these keys from R2 and only then calls `finish_media_deletes`, so an R2
-- failure leaves the rows to retry next hour.
create function public.due_media_deletes(max_rows integer default 500)
returns table (id bigint, key text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.key
  from public.pending_media_deletes as d
  where d.purge_after <= now()
  order by d.purge_after, d.id
  limit least(greatest(coalesce(max_rows, 500), 1), 1000);
$$;

-- Forgets queue rows whose objects are gone from R2. Only rows that are due, so a stray id
-- can't drop media that must still be kept. Returns how many rows were removed.
create function public.finish_media_deletes(ids bigint[])
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.pending_media_deletes as d
    where d.id = any(coalesce(ids, '{}')) and d.purge_after <= now()
    returning 1
  )
  select count(*)::int from gone;
$$;

-- Report chat context is kept for 30 days (TRUST_AND_SAFETY.md). The report row stays, so the
-- moderation history survives; only the chat lines go. Returns how many reports were cleared.
create function public.purge_report_context(keep_days integer default 30)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with cleared as (
    update public.reports as r
    set context = null
    where r.context is not null
      and r.created_at < now() - make_interval(days => greatest(coalesce(keep_days, 30), 1))
    returning 1
  )
  select count(*)::int from cleared;
$$;

-- Daily check of the visit rollup that `ingest_booth_stats` writes. It reports, it fixes
-- nothing: the Worker logs the result and sends anything suspicious to Sentry.
--   rows / visits / tryClicks: yesterday's totals (UTC)
--   uniqueOverVisits: rows in the last 7 days where unique visitors exceed visits (impossible)
--   futureRows: rows dated after tomorrow (a clock or client bug)
--   gap: there were visits the day before yesterday but no rows at all yesterday, which usually
--        means the realtime → web stats ingest is broken
create function public.booth_stats_sanity(check_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d date := coalesce(check_day, (now() at time zone 'utc')::date - 1);
  y record;
  before_visits bigint;
  over_count integer;
  future_count integer;
begin
  select count(*)::int as rows, coalesce(sum(s.visits), 0)::bigint as visits,
         coalesce(sum(s.try_clicks), 0)::bigint as try_clicks
    into y
    from public.booth_stats_daily as s
    where s.day = d;
  select coalesce(sum(s.visits), 0) into before_visits
    from public.booth_stats_daily as s
    where s.day = d - 1;
  select count(*)::int into over_count
    from public.booth_stats_daily as s
    where s.day between d - 6 and d and s.unique_visitors > s.visits;
  select count(*)::int into future_count
    from public.booth_stats_daily as s
    where s.day > d + 2;
  return jsonb_build_object(
    'day', d,
    'rows', y.rows,
    'visits', y.visits,
    'tryClicks', y.try_clicks,
    'uniqueOverVisits', over_count,
    'futureRows', future_count,
    'gap', before_visits > 0 and y.rows = 0
  );
end;
$$;

revoke execute on function public.due_media_deletes(integer) from public, anon, authenticated;
revoke execute on function public.finish_media_deletes(bigint[]) from public, anon, authenticated;
revoke execute on function public.purge_report_context(integer) from public, anon, authenticated;
revoke execute on function public.booth_stats_sanity(date) from public, anon, authenticated;
grant execute on function public.due_media_deletes(integer) to service_role;
grant execute on function public.finish_media_deletes(bigint[]) to service_role;
grant execute on function public.purge_report_context(integer) to service_role;
grant execute on function public.booth_stats_sanity(date) to service_role;
