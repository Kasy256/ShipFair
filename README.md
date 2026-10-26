# ShipFair

> A free, walkable 3D city where indie makers get a booth for their AI, SaaS and side projects, and everyone explores together, live, in the browser.

*Working name. Change it in `packages/shared/src/brand.ts`.*

## What's in this repo (so far)
This is the **build kit**: the docs and prompts used to build ShipFair step by step with Claude Code. The application code is generated prompt by prompt into the structure described in `docs/ARCHITECTURE.md`.

```
CLAUDE.md                     Instructions Claude Code reads automatically
docs/
  PRODUCT.md                  Vision, v1 scope, non-goals, success signals
  TECH_STACK.md               Chosen stack, versions, why, risks
  ARCHITECTURE.md             System diagram, repo layout, data model, API, realtime protocol
  INFRASTRUCTURE.md           Environments, secrets, CI/CD, caching, costs, monitoring, runbook
  CODING_STANDARDS.md         Rules for code, tests, PRs
  TRUST_AND_SAFETY.md         Moderation, chat rules, privacy
  ROADMAP.md                  Phases and milestones, mapped to prompts
prompts/
  README.md                   How to run the prompts with Claude Code
  TEMPLATE.md                 Template for writing new prompts
  00-kickoff.md … 16-launch-prep.md
.env.example                  Every config value the apps need
```

## Stack at a glance
Three.js + Rapier (engine) · React 19 + Tailwind (UI) · Vite 8 · TypeScript · Supabase (Postgres, Auth, RLS) · Cloudflare Workers + Durable Objects via PartyServer (site, API, multiplayer) · R2 (media) · Turnstile · Sentry · PostHog · Biome · Vitest · Playwright · pnpm + Turborepo · GitHub Actions.

Details and reasoning are in [`docs/TECH_STACK.md`](docs/TECH_STACK.md).

## Getting started

**Prerequisites:** Node 24 LTS (`.nvmrc`) and pnpm 12 (`corepack enable` picks up the pinned version). Local dev needs no Cloudflare login. Docker is needed for the local database. The Supabase CLI comes in as a dev dependency (`pnpm exec supabase`).

```bash
pnpm install
pnpm dev                            # web on http://localhost:5173, realtime on http://localhost:1999
```

Check that both Workers are up and can reach each other over their service bindings:

```bash
curl localhost:5173/api/health            # {"ok":true,"version":"0.0.0"}
curl localhost:1999/health                # {"ok":true}
curl localhost:5173/api/dev/ping-realtime # web → realtime RPC
curl localhost:1999/dev/ping-web          # realtime → web RPC
```

Other commands:

```bash
pnpm lint          # biome ci
pnpm format        # biome check --write
pnpm typecheck
pnpm test          # vitest (Worker tests run inside workerd)
pnpm build
pnpm --filter @shipfair/e2e exec playwright install chromium   # once
pnpm e2e           # playwright; needs `pnpm dev` running
```

### Database (local Supabase in Docker)

```bash
pnpm db:start      # first run pulls the images; prints the local URLs and keys
pnpm db:reset      # re-apply every migration from zero, then supabase/seed.sql
pnpm db:test       # pgTAP policy tests in supabase/tests
pnpm db:lint       # supabase db lint + the "every table has RLS" check
pnpm db:types      # regenerate packages/shared/src/db.types.ts
pnpm db:stop
```

Copy `.env.example` to `.env.local` and fill the Supabase keys from `pnpm exec supabase status` (see `docs/INFRASTRUCTURE.md` §4). The seed adds 40 fictional example booths and three email + password users for e2e: `maker1@example.com`, `maker2@example.com` and `admin@example.com` (role `admin`), all with password `password123`. Email sign-in exists locally only. GitHub and Google sign-in stay off until you export the `SUPABASE_AUTH_EXTERNAL_*` values from `.env.example` and restart.

If a ping returns `Network connection lost` after a dev server was killed hard, delete the stale entries in wrangler's dev registry (`~/.wrangler/registry`, or `%APPDATA%\xdg.config\.wrangler\registry` on Windows) and restart `pnpm dev`.

## How we build it
1. Open the repo in Claude Code.
2. Run `prompts/00-kickoff.md`.
3. Run each numbered prompt in order, one branch and one PR each.
4. Review, test, merge, repeat. See [`prompts/README.md`](prompts/README.md).

## Status
- [ ] Phase 0: Foundations
- [ ] Phase 1: Walkable city
- [ ] Phase 2: Makers
- [ ] Phase 3: Together
- [ ] Phase 4: Ready for Reddit
