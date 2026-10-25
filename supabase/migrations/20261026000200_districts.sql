-- Districts: themed areas of the city.

create table public.districts (
  id smallint primary key,
  slug text unique not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (char_length(name) between 1 and 40),
  theme text not null check (theme ~ '^[a-z0-9-]{1,32}$'), -- engine theme key
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order smallint not null
);

alter table public.districts enable row level security;
