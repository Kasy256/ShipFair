-- Booths: a maker's product in the city.

create type public.booth_status as enum ('draft', 'pending', 'approved', 'rejected', 'hidden', 'archived');
create type public.booth_tier as enum ('stall', 'booth', 'pavilion');

-- Every media key must sit under the owner's upload prefix `u/<owner_id>/`, so a booth can't point
-- at someone else's objects. `..` segments are rejected too. At most 5 media items.
create function public.booth_media_keys_valid(owner uuid, logo_key text, media jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(media) = 'array'
    and jsonb_array_length(media) <= 5
    and (
      logo_key is null
      or (starts_with(logo_key, 'u/' || owner::text || '/') and strpos(logo_key, '..') = 0)
    )
    and not exists (
      select 1
      from jsonb_array_elements(media) as item
      where jsonb_typeof(item) <> 'object'
        or jsonb_typeof(item -> 'key') is distinct from 'string'
        or not starts_with(item ->> 'key', 'u/' || owner::text || '/')
        or strpos(item ->> 'key', '..') > 0
    );
$$;

create table public.booths (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles on delete cascade,
  slug text unique not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (char_length(name) between 2 and 40),
  tagline text not null check (char_length(tagline) between 10 and 90),
  description text check (char_length(description) <= 600),
  url text not null check (url ~ '^https://'),
  district_id smallint not null references public.districts,
  logo_key text, -- R2 object key
  media jsonb not null default '[]'::jsonb, -- [{type:'image'|'video', key, w, h}] max 5
  pricing text check (pricing in ('free', 'freemium', 'paid', 'open-source')),
  status public.booth_status not null default 'draft',
  tier public.booth_tier not null default 'stall',
  reject_reason text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booths_media_keys_valid check (public.booth_media_keys_valid(owner_id, logo_key, media))
);

create index booths_status_district_approved_idx on public.booths (status, district_id, approved_at);
create index booths_owner_id_idx on public.booths (owner_id);
create index booths_district_id_idx on public.booths (district_id);

alter table public.booths enable row level security;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger booths_set_updated_at
  before update on public.booths
  for each row execute function public.set_updated_at();
