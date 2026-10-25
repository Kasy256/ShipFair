// Types `exports` from `cloudflare:workers` (used by the Worker tests) and `ctx.exports`.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('./index.ts');
    durableNamespaces: 'Coordinator' | 'WorldShard';
  }
}
