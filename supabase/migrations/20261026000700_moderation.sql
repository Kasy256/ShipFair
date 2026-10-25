-- Reports, the staff action log and bans (TRUST_AND_SAFETY.md).

create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references public.profiles on delete set null,
  target_type text not null check (target_type in ('booth', 'guestbook', 'chat', 'user')),
  target_id text not null check (char_length(target_id) between 1 and 64),
  reason text not null check (reason in ('spam', 'scam', 'nsfw', 'hate', 'other')),
  note text check (char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  -- Booth and user targets are uuids, so auto-hide can find the booth by primary key.
  constraint reports_target_id_uuid check (
    target_type not in ('booth', 'user')
    or target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

create index reports_reporter_id_idx on public.reports (reporter_id);
create index reports_open_target_idx on public.reports (target_type, target_id) where status = 'open';
-- One open report per reporter per target, so a single account can't stack reports.
create unique index reports_one_open_per_reporter_idx
  on public.reports (reporter_id, target_type, target_id)
  where status = 'open';

create table public.moderation_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles on delete set null, -- null = system or deleted account
  actor_handle text, -- kept so the log stays readable after deletion
  action text not null, -- approve, reject, hide, ban, unban, auto_hide, ...
  target_type text not null,
  target_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index moderation_log_actor_id_idx on public.moderation_log (actor_id);
create index moderation_log_target_idx on public.moderation_log (target_type, target_id);

create table public.bans (
  user_id uuid primary key references public.profiles on delete cascade,
  reason text not null,
  until timestamptz, -- null = permanent
  created_at timestamptz not null default now()
);

-- Survives account deletion (no FK to profiles).
create table public.banned_identities (
  identity_hash text primary key check (identity_hash ~ '^[0-9a-f]{64}$'), -- sha256(provider || ':' || provider user id), hex
  reason text not null,
  until timestamptz,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;
alter table public.moderation_log enable row level security;
alter table public.bans enable row level security;
alter table public.banned_identities enable row level security;
