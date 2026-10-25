## What and why

<!-- What changed, and the reason. Link the prompt or issue. -->

## Screenshots or video

<!-- Required for visual changes. Delete if none. -->

## Tests added

<!-- Which tests cover this, and the numbers from running them. -->

## Perf impact

<!-- Draw calls, triangles, bundle size or tick time before/after, or "none". -->

## Migration notes

<!-- New migrations, env vars, secrets or deploy-order steps, or "none". -->

## New dependencies

<!-- For each: why, size, maintenance status. Or "none". -->

## Checklist (runtime code)

- [ ] No new per-frame allocations
- [ ] New GPU resources are disposed
- [ ] Draw calls checked on the perf test page (`/?debug=perf`)
- [ ] All new inputs validated with zod
- [ ] No secrets in client code. Only `VITE_*` public values reach the browser
- [ ] User-supplied text is rendered as text (never `innerHTML`), and URLs are checked to be `https:`
- [ ] Targets `Development` (not `main`), CI is green
