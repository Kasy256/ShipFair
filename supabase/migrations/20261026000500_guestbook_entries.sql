-- Guestbook: short public notes on a booth, 5 per user per 10 minutes (TRUST_AND_SAFETY.md).

create table public.guestbook_entries (
  id bigint generated always as identity primary key,
  booth_id uuid not null references public.booths on delete cascade,
  author_id uuid not null references public.profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 200),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index guestbook_entries_booth_id_idx on public.guestbook_entries (booth_id, created_at);
-- Serves the author_id FK and the rate-limit count.
create index guestbook_entries_author_id_idx on public.guestbook_entries (author_id, created_at);

alter table public.guestbook_entries enable row level security;

-- Security definer so hidden entries (invisible under RLS) still count toward the limit.
create function public.guestbook_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialise one author's inserts so concurrent requests can't both slip under the limit.
  perform pg_advisory_xact_lock(hashtextextended('guestbook:' || new.author_id::text, 0));

  if (
    select count(*)
    from public.guestbook_entries
    where author_id = new.author_id
      and created_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'guestbook rate limit: 5 entries per 10 minutes'
      using errcode = 'P0001', hint = 'rate_limited';
  end if;

  return new;
end;
$$;

create trigger guestbook_entries_rate_limit
  before insert on public.guestbook_entries
  for each row execute function public.guestbook_rate_limit();
