# CLAUDE.md

ShipFair (working name) is a free, walkable, multiplayer 3D city in the browser where indie makers get booths for their AI, SaaS and side projects.

## Read before working
- `docs/PRODUCT.md` covers what we're building and what we're not.
- `docs/ARCHITECTURE.md` is the source of truth for structure, data model, API and realtime protocol.
- `docs/CODING_STANDARDS.md` lists rules you must follow. Don't drift from them silently.
- `docs/TECH_STACK.md` has the versions to use. Don't upgrade or add dependencies without saying why.
- `docs/TRUST_AND_SAFETY.md` covers moderation rules that are part of v1.
- `docs/INFRASTRUCTURE.md` covers environments, secrets, deploys and costs.

## Layout
- `apps/web`: React SPA + Hono Worker (`/api`, meta tags, OG images)
- `apps/realtime`: PartyServer Durable Objects (Coordinator, WorldShard)
- `packages/engine`: Three.js + Rapier runtime. **No React in here.**
- `packages/shared`: zod schemas, protocol, layout, constants, brand
- `supabase/`: migrations, seed, policy tests
- `reference/agenticon/`: the earlier prototype. **Read-only.** Port ideas and code from it; never import from it. It's excluded from Biome, TypeScript, Vitest and Vite. `docs/KICKOFF_NOTES.md` has the porting map.

## Commands
```
pnpm install
pnpm dev              # web (Vite + Worker) + realtime (wrangler dev)
pnpm db:start         # local Supabase (Postgres/Auth) in Docker
pnpm db:reset && pnpm db:test   # migrations + seed from zero, then pgTAP policy tests
pnpm db:lint          # supabase db lint + every-table-has-RLS check
pnpm db:types         # regenerate packages/shared/src/db.types.ts
pnpm biome check --write
pnpm typecheck
pnpm test             # vitest across workspace
pnpm e2e              # playwright (needs dev servers + supabase running)
pnpm build
```

## Non-negotiables
1. Validate every external input with zod schemas from `packages/shared`.
2. RLS on every table. Schema changes only via new migration files.
3. The server never trusts the client: clamp movement, rate-limit, filter chat.
4. No per-frame allocations in the engine. Dispose GPU resources. Instancing first.
5. No secrets in client code. Only `VITE_*` values reach the browser.
6. Engine tests use deterministic stepping (`engine.step(dt, n)`), not real-time waits.
7. Keep PRs focused on the current prompt (one prompt = one PR, in reviewable commits).
8. Branch from `Development` and open PRs into `Development`. Never commit or push to `main`; it only receives reviewed `Development` → `main` PRs. If you find work outside scope, list it under "Follow-ups" instead of doing it.

## When you finish a task
Report:
- what changed (files)
- how you verified it, **with numbers** (tests run and passing, perf figures, screenshots taken)
- anything not done or uncertain
- follow-ups

If verification couldn't run (no GPU, no Docker), say so plainly. Don't claim it passed.
