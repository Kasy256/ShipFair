// Writes the local Supabase anon key into apps/web/.dev.vars (gitignored) so the web Worker's
// `/api/world` can read the local database. The key is signed with this machine's key
// (ensure-signing-key.mjs), so it can't be committed. Other lines in .dev.vars are kept.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const devVarsPath = fileURLToPath(new URL('../../apps/web/.dev.vars', import.meta.url));

const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const values = Object.fromEntries(
  [...status.matchAll(/^([A-Z_]+)="?([^"\r\n]*)"?$/gm)].map((m) => [m[1], m[2]]),
);
// Newer CLIs also print a publishable key; the legacy anon JWT works with RLS either way.
const anonKey = values.ANON_KEY || values.PUBLISHABLE_KEY;
if (!anonKey) {
  console.error('supabase status printed no ANON_KEY; is the local stack running?');
  process.exit(1);
}

const wanted = { SUPABASE_ANON_KEY: anonKey };
const lines = existsSync(devVarsPath)
  ? readFileSync(devVarsPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
  : [];
const kept = lines.filter((line) => !Object.keys(wanted).some((key) => line.startsWith(`${key}=`)));
const next = [...kept, ...Object.entries(wanted).map(([key, value]) => `${key}=${value}`)];
writeFileSync(devVarsPath, `${next.join('\n')}\n`);
console.log('wrote SUPABASE_ANON_KEY to apps/web/.dev.vars');
