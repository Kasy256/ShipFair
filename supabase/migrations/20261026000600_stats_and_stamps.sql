-- Daily visit stats (written by the API from realtime batches) and passport stamps.

create table public.booth_stats_daily (
  booth_id uuid references public.booths on delete cascade,
  day date not null,
  unique_visitors int not null default 0 check (unique_visitors >= 0),
  visits int not null default 0 check (visits >= 0),
  try_clicks int not null default 0 check (try_clicks >= 0),
  primary key (booth_id, day)
);

create table public.passport_stamps (
  user_id uuid references public.profiles on delete cascade,
  stamp text not null check (char_length(stamp) between 1 and 64), -- 'district:ai-agents', 'booths:10', ...
  created_at timestamptz not null default now(),
  primary key (user_id, stamp)
);

-- Both FKs lead their primary key, so they need no extra index.
alter table public.booth_stats_daily enable row level security;
alter table public.passport_stamps enable row level security;
