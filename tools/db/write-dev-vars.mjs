// Writes this machine's local Supabase keys where the dev servers read them (both files are
// gitignored; the keys are signed with this machine's key, see ensure-signing-key.mjs):
//   apps/web/.dev.vars               SUPABASE_ANON_KEY (/api/world) and SUPABASE_SERVICE_ROLE_KEY
//                                    (/api/me/delete) for the web Worker
//   apps/web/.env.development.local  VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for the SPA
//                                    (sign-in, profiles)
// Other lines in those files are kept.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const devVarsPath = fileURLToPath(new URL('../../apps/web/.dev.vars', import.meta.url));
const viteEnvPath = fileURLToPath(
  new URL('../../apps/web/.env.development.local', import.meta.url),
);

const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const values = Object.fromEntries(
  [...status.matchAll(/^([A-Z_]+)="?([^"\r\n]*)"?$/gm)].map((m) => [m[1], m[2]]),
);
// Newer CLIs also print publishable/secret keys; the legacy JWTs work with RLS either way.
const anonKey = values.ANON_KEY || values.PUBLISHABLE_KEY;
const serviceKey = values.SERVICE_ROLE_KEY || values.SECRET_KEY;
const apiUrl = values.API_URL || 'http://127.0.0.1:54321';
if (!anonKey || !serviceKey) {
  console.error(
    'supabase status printed no ANON_KEY/SERVICE_ROLE_KEY; is the local stack running?',
  );
  process.exit(1);
}

/** Replaces `wanted` keys in a KEY=value file, keeping every other line. */
function writeVars(path, wanted) {
  const lines = existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
    : [];
  const kept = lines.filter(
    (line) => !Object.keys(wanted).some((key) => line.startsWith(`${key}=`)),
  );
  const next = [...kept, ...Object.entries(wanted).map(([key, value]) => `${key}=${value}`)];
  writeFileSync(path, `${next.join('\n')}\n`);
  console.log(`wrote ${Object.keys(wanted).join(', ')} to ${path}`);
}

writeVars(devVarsPath, { SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey });
writeVars(viteEnvPath, { VITE_SUPABASE_URL: apiUrl, VITE_SUPABASE_ANON_KEY: anonKey });
