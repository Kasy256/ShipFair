// `node tools/bundle-budget.ts [dist]`: the JS a first visit to the city downloads before "Enter",
// per chunk (raw, gzip, brotli), checked against `firstLoadJsGzipKb` in e2e/perf-budgets.json.
// First load = index.html's entry and everything it imports statically, plus the engine chunk
// (every world route imports it at boot) and its static imports. Rapier's JS loader and its .wasm
// (taken out of the compat build by vite.config.ts) are listed but stay outside the budget
// (TECH_STACK.md). Run after `pnpm build`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.argv[2] ?? join(ROOT, 'apps/web/dist/client'));
const assets = join(dist, 'assets');
const budgets = JSON.parse(readFileSync(join(ROOT, 'e2e/perf-budgets.json'), 'utf8')) as {
  firstLoadJsGzipKb?: unknown;
};
const limitKb = budgets.firstLoadJsGzipKb;
if (typeof limitKb !== 'number') throw new Error('e2e/perf-budgets.json: no firstLoadJsGzipKb');

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = /<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
const files = readdirSync(assets).filter((f) => f.endsWith('.js'));
// The engine package's chunk: Rolldown names it after its folder (`src`).
const engine = files.find((f) => /^src-[\w-]+\.js$/.test(f));
if (!entry || !engine) throw new Error(`entry (${entry}) or engine chunk (${engine}) not found`);

const staticImports = (file: string): string[] =>
  [...readFileSync(join(assets, file), 'utf8').matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)]
    .map((m) => m[1])
    .filter((f): f is string => f !== undefined);

const seen = new Set<string>();
const stack = [entry, engine];
for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
  if (seen.has(file)) continue;
  seen.add(file);
  stack.push(...staticImports(file));
}

// Rapier's WASM (extracted from its compat build by vite.config.ts) is fetched at boot too.
for (const file of readdirSync(assets)) if (/^rapier-[\w-]+\.wasm$/.test(file)) seen.add(file);

const kb = (bytes: number) => (bytes / 1024).toFixed(1).padStart(8);
const rows = [...seen]
  .map((name) => {
    const bytes = readFileSync(join(assets, name));
    return {
      name,
      raw: bytes.length,
      gzip: gzipSync(bytes, { level: 9 }).length,
      brotli: brotliCompressSync(bytes, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).length,
      isRapier: name.startsWith('rapier-'),
    };
  })
  .sort((a, b) => b.gzip - a.gzip);

console.log(
  `${'chunk'.padEnd(36)}${'raw KB'.padStart(8)}${'gzip'.padStart(8)}${'brotli'.padStart(8)}`,
);
const total = { raw: 0, gzip: 0, brotli: 0 };
for (const row of rows) {
  console.log(`${row.name.padEnd(36)}${kb(row.raw)}${kb(row.gzip)}${kb(row.brotli)}`);
  if (row.isRapier) continue;
  total.raw += row.raw;
  total.gzip += row.gzip;
  total.brotli += row.brotli;
}
console.log(
  `${'first load, excl. Rapier'.padEnd(36)}${kb(total.raw)}${kb(total.gzip)}${kb(total.brotli)}`,
);

const gzipKb = total.gzip / 1024;
if (gzipKb > limitKb) {
  console.error(`First-load JS is ${gzipKb.toFixed(1)} KB gzip, over the ${limitKb} KB budget.`);
  process.exitCode = 1;
} else {
  console.log(`OK: ${gzipKb.toFixed(1)} KB gzip of ${limitKb} KB.`);
}
