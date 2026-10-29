// `pnpm db:start [supabase start flags]`: signing key, then the local stack, then .dev.vars.
// A wrapper rather than an `&&` chain, because pnpm appends extra arguments to the last command
// and CI passes `-x <services>` meant for `supabase start`.
import { execFileSync } from 'node:child_process';

const run = (command, args) =>
  execFileSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });

run('node', ['tools/db/ensure-signing-key.mjs']);
run('pnpm', ['exec', 'supabase', 'start', ...process.argv.slice(2)]);
run('node', ['tools/db/write-dev-vars.mjs']);
