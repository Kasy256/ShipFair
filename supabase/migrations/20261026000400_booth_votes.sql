-- Votes: one per user per booth. Clients read totals from booth_vote_counts.

create table public.booth_votes (
  booth_id uuid references public.booths on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (booth_id, user_id)
);

-- booth_id is covered by the primary key.
create index booth_votes_user_id_idx on public.booth_votes (user_id);

alter table public.booth_votes enable row level security;

-- Runs with the view owner's rights (no security_invoker) so it can count every vote while RLS
-- keeps individual rows private. Lists approved booths only.
create view public.booth_vote_counts as
select v.booth_id, count(*)::int as votes
from public.booth_votes as v
join public.booths as b on b.id = v.booth_id and b.status = 'approved'
group by v.booth_id;
