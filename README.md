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

## Getting started (once prompt 01 has run)

**Prerequisites:** Node 24 LTS, pnpm 12, Docker (for local Supabase), the Supabase CLI, and a Cloudflare account with wrangler logged in.

```bash
pnpm install
cp .env.example .env.local          # fill in values (see docs/INFRASTRUCTURE.md §4)
supabase start                      # local DB + auth
supabase db reset                   # apply migrations + seed
pnpm dev                            # http://localhost:5173
```

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
