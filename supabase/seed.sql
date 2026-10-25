-- Local and staging seed ONLY. Never run against production (INFRASTRUCTURE.md §3).
-- Every booth here is a made-up example: `example-` slugs, https://example.com URLs, and a
-- description that says so.

-- Districts ------------------------------------------------------------------------------------

insert into public.districts (id, slug, name, theme, color, sort_order) values
  (1, 'ai-agents', 'AI Agents', 'ai-agents', '#7c3aed', 1),
  (2, 'dev-tools', 'Dev Tools', 'dev-tools', '#0ea5e9', 2),
  (3, 'productivity', 'Productivity & SaaS', 'productivity', '#22c55e', 3),
  (4, 'design', 'Design', 'design', '#f97316', 4),
  (5, 'marketing', 'Marketing', 'marketing', '#ec4899', 5),
  (6, 'finance-ops', 'Finance & Ops', 'finance-ops', '#eab308', 6),
  (7, 'games-fun', 'Games & Fun', 'games-fun', '#ef4444', 7),
  (8, 'weird', 'Weird & Wonderful', 'weird', '#14b8a6', 8);

-- Test users -----------------------------------------------------------------------------------
-- Email + password sign-in exists locally only, for e2e. Password for all three: `password123`.
-- on_auth_user_created makes the profiles; we then give them stable handles.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', u.display_name),
  now() - interval '30 days', now(),
  '', '', '', ''
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'maker1@example.com', 'Maker One'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'maker2@example.com', 'Maker Two'),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'admin@example.com', 'Admin')
) as u (id, email, display_name);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users as u
where u.email in ('maker1@example.com', 'maker2@example.com', 'admin@example.com');

update public.profiles as p
set handle = v.handle, role = v.role
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'maker1', 'user'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'maker2', 'user'),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'admin', 'admin')
) as v (id, handle, role)
where p.id = v.id;

-- Example booths -------------------------------------------------------------------------------
-- 40 approved booths over the first 3 districts, owned alternately by maker1 and maker2. A few
-- are bigger tiers so the city shows every booth size.

insert into public.booths (
  owner_id, slug, name, tagline, description, url, district_id, pricing, status, tier, approved_at
)
select
  case when b.n % 2 = 1
    then '00000000-0000-4000-8000-000000000001'::uuid
    else '00000000-0000-4000-8000-000000000002'::uuid
  end,
  'example-' || b.slug,
  b.name,
  b.tagline,
  'Example booth for local development. ' || b.name || ' is not a real product.',
  'https://example.com/' || b.slug,
  b.district_id,
  b.pricing,
  'approved',
  case when b.n in (1, 15, 28) then 'pavilion' when b.n % 5 = 0 then 'booth' else 'stall' end::public.booth_tier,
  now() - make_interval(hours => b.n * 7)
from (values
  -- AI Agents
  (1, 1, 'pretend-pilot', 'Pretend Pilot', 'An imaginary agent that books imaginary flights', 'freemium'),
  (2, 1, 'mock-butler', 'Mock Butler', 'Pretend inbox triage for people with pretend email', 'paid'),
  (3, 1, 'faux-researcher', 'Faux Researcher', 'Summarises papers that were never written', 'free'),
  (4, 1, 'dummy-dispatch', 'Dummy Dispatch', 'Routes fictional support tickets to fictional agents', 'freemium'),
  (5, 1, 'sample-scribe', 'Sample Scribe', 'Takes meeting notes for meetings that never happened', 'paid'),
  (6, 1, 'phantom-planner', 'Phantom Planner', 'Plans your week using made-up calendar data', 'free'),
  (7, 1, 'placeholder-pal', 'Placeholder Pal', 'A chat companion that only speaks in lorem ipsum', 'open-source'),
  (8, 1, 'stub-scout', 'Stub Scout', 'Scouts the web for links to example.com', 'free'),
  (9, 1, 'test-tutor', 'Test Tutor', 'Explains homework that nobody was assigned', 'freemium'),
  (10, 1, 'fictive-fixer', 'Fictive Fixer', 'Opens pull requests on repositories that do not exist', 'paid'),
  (11, 1, 'imaginary-intern', 'Imaginary Intern', 'Fetches coffee, conceptually, on every request', 'free'),
  (12, 1, 'nominal-negotiator', 'Nominal Negotiator', 'Haggles over prices for products made of air', 'paid'),
  (13, 1, 'demo-detective', 'Demo Detective', 'Solves mysteries from the sample data folder', 'open-source'),
  (14, 1, 'sham-shopper', 'Sham Shopper', 'Compares prices across stores that are all example.com', 'freemium'),
  -- Dev Tools
  (15, 2, 'fake-forge', 'Fake Forge', 'A CI pipeline that is always green because it is fake', 'open-source'),
  (16, 2, 'lorem-lint', 'Lorem Lint', 'Lints your code for excessive lorem ipsum', 'free'),
  (17, 2, 'null-logger', 'Null Logger', 'Logs everything straight to /dev/null at record speed', 'open-source'),
  (18, 2, 'env-mirage', 'Env Mirage', 'Manages environment variables for example projects', 'freemium'),
  (19, 2, 'pseudo-profiler', 'Pseudo Profiler', 'Finds hot paths in code you have not written yet', 'paid'),
  (20, 2, 'mockingbird-api', 'Mockingbird API', 'Mocks every endpoint by repeating what you sent', 'free'),
  (21, 2, 'sandbox-sprout', 'Sandbox Sprout', 'Spins up throwaway sandboxes that grow on trees', 'freemium'),
  (22, 2, 'diff-daydream', 'Diff Daydream', 'Reviews diffs between two versions of nothing', 'free'),
  (23, 2, 'schema-sketch', 'Schema Sketch', 'Draws database diagrams for tables named foo and bar', 'open-source'),
  (24, 2, 'fixture-factory', 'Fixture Factory', 'Mass-produces test fixtures in a fictional factory', 'paid'),
  (25, 2, 'regex-reverie', 'Regex Reverie', 'Writes regular expressions you will dream about', 'free'),
  (26, 2, 'deploy-decoy', 'Deploy Decoy', 'Deploys to staging, which is also a decoy', 'freemium'),
  (27, 2, 'cache-chimera', 'Cache Chimera', 'Caches answers to questions nobody asked', 'paid'),
  -- Productivity & SaaS
  (28, 3, 'todo-tofu', 'Todo Tofu', 'A to-do list that absorbs the flavour of your tasks', 'freemium'),
  (29, 3, 'inbox-imitation', 'Inbox Imitation', 'Gets you to inbox zero by hiding the inbox', 'paid'),
  (30, 3, 'calendar-cameo', 'Calendar Cameo', 'Schedules cameo appearances in fake meetings', 'free'),
  (31, 3, 'invoice-illusion', 'Invoice Illusion', 'Sends invoices to customers made of placeholder text', 'paid'),
  (32, 3, 'focus-figment', 'Focus Figment', 'A focus timer that pauses itself when you look away', 'free'),
  (33, 3, 'notes-nowhere', 'Notes Nowhere', 'Stores your notes in a cloud that is purely theoretical', 'freemium'),
  (34, 3, 'habit-hologram', 'Habit Hologram', 'Tracks habits as shimmering imaginary streaks', 'free'),
  (35, 3, 'form-fable', 'Form Fable', 'Builds forms whose answers are always once upon a time', 'freemium'),
  (36, 3, 'wiki-whimsy', 'Wiki Whimsy', 'A team wiki where every page is a sample page', 'open-source'),
  (37, 3, 'crm-cardboard', 'CRM Cardboard', 'A cardboard cutout of a customer relationship manager', 'paid'),
  (38, 3, 'docs-decoy', 'Docs Decoy', 'Writes documentation for features that are imaginary', 'free'),
  (39, 3, 'standup-stand-in', 'Standup Stand-in', 'Attends your standup and says it is blocked on nothing', 'freemium'),
  (40, 3, 'budget-bubble', 'Budget Bubble', 'Plans budgets in a currency that only exists here', 'free')
) as b (n, district_id, slug, name, tagline, pricing);
