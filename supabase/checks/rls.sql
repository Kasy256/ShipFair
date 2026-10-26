-- CI gate: fails when any table in an API-exposed schema has row level security off
-- (CODING_STANDARDS.md §7). Run by `pnpm db:lint`.
do $$
declare
  missing text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ' order by n.nspname, c.relname)
  into missing
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname in ('public', 'graphql_public')
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;

  if missing is not null then
    raise exception 'tables without row level security: %', missing;
  end if;

  raise notice 'RLS check passed: every exposed table has row level security enabled';
end;
$$;
