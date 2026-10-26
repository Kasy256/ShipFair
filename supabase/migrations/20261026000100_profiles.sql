-- Profiles: 1:1 with auth.users, created by a trigger on signup.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  handle text unique not null check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 32),
  avatar_style jsonb not null default '{}'::jsonb,
  links jsonb not null default '{}'::jsonb,
  role text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  created_at timestamptz not null default now()
);

-- Policies come in the RLS migration. Until then only the service role can touch the table.
alter table public.profiles enable row level security;

-- Signup: a random `maker_xxxxxx` handle (the user picks a real one later) and a display name from
-- the OAuth metadata, falling back to "Maker".
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  display text;
  candidate text;
begin
  display := left(btrim(coalesce(
    nullif(btrim(meta ->> 'full_name'), ''),
    nullif(btrim(meta ->> 'name'), ''),
    nullif(btrim(meta ->> 'user_name'), ''),
    nullif(btrim(meta ->> 'preferred_username'), ''),
    'Maker'
  )), 32);

  loop
    candidate := 'maker_' || (
      select string_agg(substr(alphabet, 1 + floor(random() * 36)::int, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from public.profiles where handle = candidate);
  end loop;

  insert into public.profiles (id, handle, display_name) values (new.id, candidate, display);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
