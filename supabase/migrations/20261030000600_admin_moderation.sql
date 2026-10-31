-- Prompt 09: staff tools. Feature flags, the one function every staff action goes through (so the
-- change and its moderation_log row commit together), and two read-only views for /admin.

-- Feature flags ----------------------------------------------------------------------------------

-- Read by the web Worker (cached 30 s) and edited in /admin. Values are validated by the shared
-- `FlagUpdate` schema before they get here. Service role only: RLS on, no policies.
create table public.flags (
  key text primary key check (key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  value jsonb not null,
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.flags enable row level security;

-- Production defaults (TRUST_AND_SAFETY.md). seed.sql lowers the account age for local work.
insert into public.flags (key, value) values
  ('MIN_ACCOUNT_AGE_MINUTES', '60'),
  ('GUEST_CHAT', 'false'),
  ('NEW_ACCOUNT_CHAT_MINUTES', '0'),
  ('SUBMISSIONS_OPEN', 'true');

-- The log viewer filters by action, newest first.
create index moderation_log_action_idx on public.moderation_log (action, id desc);

-- admin_action -----------------------------------------------------------------------------------

-- Every staff mutation: checks the actor is staff, applies the change, and writes moderation_log
-- in the same transaction. Called by `/api/admin/*` with the service role after the Worker has
-- verified the caller's JWT and role; the staff check here is a second fence.
-- Errors are P0001 with a hint the Worker maps to an HTTP status: forbidden, not_found,
-- not_actionable (the target isn't in a state this action applies to) and bad_request.
create function public.admin_action(actor uuid, action text, target_id text, payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor_handle text;
  log_action text := action;
  log_target text;
  result jsonb := '{}'::jsonb;
  rev public.booth_revisions;
  old_keys text[];
  is_hidden boolean := coalesce((payload ->> 'hidden')::boolean, true);
  changed integer;
begin
  select p.handle into actor_handle
  from public.profiles as p
  where p.id = actor and p.role in ('moderator', 'admin');
  if actor_handle is null then
    raise exception 'only staff can moderate' using errcode = 'P0001', hint = 'forbidden';
  end if;

  case action
    when 'approve_booth' then
      log_action := 'approve';
      log_target := 'booth';
      update public.booths
      set status = 'approved', approved_at = now(), reject_reason = null
      where id = target_id::uuid and status = 'pending';
      if not found then
        raise exception 'booth is not pending' using errcode = 'P0001', hint = 'not_actionable';
      end if;
      result := jsonb_build_object('boothId', target_id);

    when 'approve_revision' then
      log_target := 'booth_revision';
      select * into rev from public.booth_revisions as r
      where r.id = target_id::uuid and r.status = 'pending'
      for update;
      if not found then
        raise exception 'revision is not pending' using errcode = 'P0001', hint = 'not_actionable';
      end if;
      select array_remove(
          b.logo_key || array(select m ->> 'key' from jsonb_array_elements(b.media) as m), null
        )
      into old_keys
      from public.booths as b
      where b.id = rev.booth_id and b.status = 'approved'
      for update;
      if not found then
        raise exception 'booth is not live' using errcode = 'P0001', hint = 'not_actionable';
      end if;
      update public.booths
      set tagline = rev.tagline, description = rev.description, url = rev.url,
        logo_key = rev.logo_key, media = rev.media
      where id = rev.booth_id;
      update public.booth_revisions set status = 'approved', reject_reason = null, decided_at = now()
      where id = rev.id;
      -- Images the edit replaced join the 30-day purge queue, unless a booth or an open edit still
      -- uses them (keys are content hashes, so one image can be shared).
      insert into public.pending_media_deletes (key)
      select distinct k from unnest(old_keys) as k
      where not exists (
          select 1 from public.booths as b
          where b.logo_key = k or b.media @> jsonb_build_array(jsonb_build_object('key', k))
        )
        and not exists (
          select 1 from public.booth_revisions as r
          where r.status = 'pending'
            and (r.logo_key = k or r.media @> jsonb_build_array(jsonb_build_object('key', k)))
        );
      get diagnostics changed = row_count;
      result := jsonb_build_object('boothId', rev.booth_id, 'queuedMedia', changed);

    when 'reject_booth' then
      log_action := 'reject';
      log_target := 'booth';
      update public.booths set status = 'rejected', reject_reason = payload ->> 'reasonText'
      where id = target_id::uuid and status = 'pending';
      if not found then
        raise exception 'booth is not pending' using errcode = 'P0001', hint = 'not_actionable';
      end if;

    when 'reject_revision' then
      log_target := 'booth_revision';
      update public.booth_revisions
      set status = 'rejected', reject_reason = payload ->> 'reasonText', decided_at = now()
      where id = target_id::uuid and status = 'pending'
      returning booth_id into rev.booth_id;
      if not found then
        raise exception 'revision is not pending' using errcode = 'P0001', hint = 'not_actionable';
      end if;
      result := jsonb_build_object('boothId', rev.booth_id);

    when 'hide_booth' then
      log_action := case when is_hidden then 'hide' else 'unhide' end;
      log_target := 'booth';
      update public.booths
      set status = case when is_hidden then 'hidden' else 'approved' end::public.booth_status
      where id = target_id::uuid
        and status = case when is_hidden then 'approved' else 'hidden' end::public.booth_status;
      if not found then
        raise exception 'booth is not %', case when is_hidden then 'live' else 'hidden' end
          using errcode = 'P0001', hint = 'not_actionable';
      end if;
      result := jsonb_build_object('boothId', target_id);

    when 'hide_guestbook' then
      log_action := case when is_hidden then 'hide' else 'unhide' end;
      log_target := 'guestbook';
      update public.guestbook_entries set hidden = is_hidden where id = target_id::bigint;
      if not found then
        raise exception 'no such guestbook entry' using errcode = 'P0001', hint = 'not_found';
      end if;

    when 'ban' then
      log_target := 'user';
      if not exists (select 1 from public.profiles as p where p.id = target_id::uuid) then
        raise exception 'no such user' using errcode = 'P0001', hint = 'not_found';
      end if;
      if exists (
        select 1 from public.profiles as p
        where p.id = target_id::uuid and p.role in ('moderator', 'admin')
      ) then
        raise exception 'staff accounts cannot be banned' using errcode = 'P0001', hint = 'not_actionable';
      end if;
      insert into public.bans (user_id, reason, until)
      values (target_id::uuid, payload ->> 'reason', (payload ->> 'until')::timestamptz)
      on conflict (user_id) do update set reason = excluded.reason, until = excluded.until;
      -- Hashed like is_not_banned(), so the ban outlives the account (TRUST_AND_SAFETY.md).
      insert into public.banned_identities (identity_hash, reason, until)
      select encode(sha256(convert_to(i.provider || ':' || i.provider_id, 'UTF8')), 'hex'),
        payload ->> 'reason', (payload ->> 'until')::timestamptz
      from auth.identities as i
      where i.user_id = target_id::uuid
      on conflict (identity_hash) do update set reason = excluded.reason, until = excluded.until;
      get diagnostics changed = row_count;
      result := jsonb_build_object('identities', changed);

    when 'unban' then
      log_target := 'user';
      delete from public.bans where user_id = target_id::uuid;
      delete from public.banned_identities as b
      using auth.identities as i
      where i.user_id = target_id::uuid
        and b.identity_hash = encode(sha256(convert_to(i.provider || ':' || i.provider_id, 'UTF8')), 'hex');

    when 'report_status' then
      log_target := 'report';
      update public.reports set status = payload ->> 'status' where id = target_id::bigint;
      if not found then
        raise exception 'no such report' using errcode = 'P0001', hint = 'not_found';
      end if;

    when 'set_flag' then
      log_target := 'flag';
      insert into public.flags (key, value, updated_by, updated_at)
      values (target_id, payload -> 'value', actor, now())
      on conflict (key) do update
      set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

    else
      raise exception 'unknown action %', action using errcode = 'P0001', hint = 'bad_request';
  end case;

  insert into public.moderation_log (actor_id, actor_handle, action, target_type, target_id, detail)
  values (actor, actor_handle, log_action, log_target, target_id, payload || result);
  return result;
end;
$$;

revoke execute on function public.admin_action(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_action(uuid, text, text, jsonb) to service_role;

-- Views for /admin (service role only) -----------------------------------------------------------

-- Pending booths and pending edits of live booths, with their latest pre-screen. The queue sorts
-- by score (clean first), then oldest; anything never pre-screened sorts last (score 1000).
create view public.admin_review_queue
with (security_invoker = true) as
select 'booth'::text as kind, b.id, b.id as booth_id, b.owner_id, b.updated_at as submitted_at,
  coalesce((s.detail ->> 'score')::numeric, 1000) as score,
  coalesce(s.detail -> 'flags', '[]'::jsonb) as flags,
  s.detail ->> 'finalUrl' as final_url
from public.booths as b
left join lateral (
  select l.detail from public.moderation_log as l
  where l.target_type = 'booth' and l.target_id = b.id::text and l.action = 'prescreen'
  order by l.id desc
  limit 1
) as s on true
where b.status = 'pending'
union all
select 'revision', r.id, r.booth_id, r.owner_id, r.updated_at,
  coalesce((s.detail ->> 'score')::numeric, 1000),
  coalesce(s.detail -> 'flags', '[]'::jsonb),
  s.detail ->> 'finalUrl'
from public.booth_revisions as r
join public.booths as b on b.id = r.booth_id and b.status = 'approved'
left join lateral (
  select l.detail from public.moderation_log as l
  where l.target_type = 'booth_revision' and l.target_id = r.id::text and l.action = 'prescreen'
  order by l.id desc
  limit 1
) as s on true
where r.status = 'pending';

-- Open reports grouped by what they are about, for the reports inbox.
create view public.admin_report_targets
with (security_invoker = true) as
select target_type, target_id,
  count(*)::int as open_reports,
  count(distinct reporter_id)::int as reporters,
  min(created_at) as first_at,
  max(created_at) as last_at
from public.reports
where status = 'open'
group by target_type, target_id;

revoke all on public.admin_review_queue, public.admin_report_targets from anon, authenticated;
