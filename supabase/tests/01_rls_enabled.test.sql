begin;
select plan(2);

select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class as c
   join pg_namespace as n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null,
  'every public table has RLS enabled'
);

-- No write policy may be `using (true)` / `with check (true)`.
select is(
  (select array_agg(tablename || '.' || policyname order by tablename, policyname)
   from pg_policies
   where schemaname = 'public'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and (qual = 'true' or with_check = 'true')),
  null,
  'no write policy is unconditional'
);

select * from finish();
rollback;
