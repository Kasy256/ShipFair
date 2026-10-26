-- 3 open reports from distinct reporters hide an approved booth until a moderator reviews it
-- (TRUST_AND_SAFETY.md). The hide is logged as a system action (actor_id null).

create function public.auto_hide_reported_booth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  booth uuid := new.target_id::uuid;
  reporters int;
begin
  -- Serialise reports on one booth so two concurrent third reports can't both miss the count.
  perform pg_advisory_xact_lock(hashtextextended('report:booth:' || new.target_id, 0));

  select count(distinct reporter_id) into reporters
  from public.reports
  where target_type = 'booth'
    and target_id = new.target_id
    and status = 'open';

  if reporters >= 3 then
    update public.booths set status = 'hidden' where id = booth and status = 'approved';

    if found then
      insert into public.moderation_log (action, target_type, target_id, detail)
      values ('auto_hide', 'booth', new.target_id, jsonb_build_object('open_reports', reporters));
    end if;
  end if;

  return null;
end;
$$;

create trigger reports_auto_hide_booth
  after insert on public.reports
  for each row
  when (new.target_type = 'booth' and new.status = 'open')
  execute function public.auto_hide_reported_booth();
