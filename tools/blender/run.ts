// `pnpm art:<step>`: runs one headless Blender step (or all of them with `build-all`).
// Usage: node tools/blender/run.ts <inspect|characters|animations|booth-kit|props|previews|build-all|test>
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ArtPaths,
  artPaths,
  blenderArgs,
  envSchema,
  findBlender,
  HOW_TO_SET_BLENDER,
  isSupportedVersion,
  parseBlenderVersion,
  QUIET_WARN_S,
  STEPS,
  type StepName,
  type StepResult,
  stepResultSchema,
} from './runner.ts';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TOOLS_DIR, '..', '..');

function resolveBlender(): string {
  const env = envSchema.parse(process.env);
  const blender = findBlender(env, process.platform);
  if (!blender) {
    if (env.BLENDER_PATH)
      console.error(`BLENDER_PATH points at a missing file: ${env.BLENDER_PATH}`);
    console.error(HOW_TO_SET_BLENDER);
    process.exit(1);
  }
  const probe = spawnSync(blender, ['--background', '--factory-startup', '--version'], {
    encoding: 'utf8',
  });
  const version = parseBlenderVersion(`${probe.stdout ?? ''}${probe.stderr ?? ''}`);
  if (!version || !isSupportedVersion(version)) {
    console.error(
      `Unsupported or unreadable Blender at ${blender} (${version ? `${version.major}.${version.minor}` : 'no version'}).`,
    );
    console.error(HOW_TO_SET_BLENDER);
    process.exit(1);
  }
  console.log(`[art] Blender ${version.major}.${version.minor} at ${blender}`);
  return blender;
}

/** Spawns Blender with an args array, streams its output, and nags when it goes quiet. */
function runBlender(blender: string, args: string[], label: string): Promise<number> {
  return new Promise((done) => {
    const child = spawn(blender, args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const started = Date.now();
    let lastOutput = Date.now();
    const onData = (chunk: Buffer, sink: NodeJS.WriteStream) => {
      lastOutput = Date.now();
      sink.write(chunk);
    };
    child.stdout.on('data', (c: Buffer) => onData(c, process.stdout));
    child.stderr.on('data', (c: Buffer) => onData(c, process.stderr));
    const timer = setInterval(() => {
      if (Date.now() - lastOutput >= QUIET_WARN_S * 1000) {
        console.log(
          `[art:${label}] still running (${Math.round((Date.now() - started) / 1000)} s)`,
        );
        lastOutput = Date.now();
      }
    }, 1000);
    child.on('close', (code) => {
      clearInterval(timer);
      done(code ?? 1);
    });
    child.on('error', (err) => {
      clearInterval(timer);
      console.error(`[art:${label}] could not start Blender: ${err.message}`);
      done(1);
    });
  });
}

async function runStep(blender: string, paths: ArtPaths, name: StepName): Promise<StepResult> {
  const step = STEPS.find((s) => s.name === name);
  if (!step) throw new Error(`unknown step ${name}`);
  mkdirSync(paths.reportsDir, { recursive: true });
  const resultPath = join(paths.reportsDir, `${name}.json`);
  rmSync(resultPath, { force: true });
  const payload = { step: name, ...paths, resultPath };
  console.log(`\n[art] ── ${name} ──`);
  const code = await runBlender(blender, blenderArgs(join(TOOLS_DIR, step.script), payload), name);
  if (!existsSync(resultPath)) {
    return {
      step: name,
      ok: false,
      skipped: false,
      seconds: 0,
      warnings: [],
      errors: [`Blender exited ${code} without writing ${resultPath}`],
      stats: {},
    };
  }
  const result = stepResultSchema.parse(JSON.parse(readFileSync(resultPath, 'utf8')));
  if (code !== 0 && result.ok) result.errors.push(`Blender exited with code ${code}`);
  const ok = result.errors.length === 0;
  const status = result.skipped ? 'SKIPPED' : ok ? 'OK' : 'FAILED';
  console.log(
    `[art] ${name}: ${status} in ${result.seconds} s (${result.warnings.length} warnings, ${result.errors.length} errors)`,
  );
  for (const e of result.errors) console.log(`  error: ${e}`);
  return { ...result, ok };
}

async function buildAll(blender: string, paths: ArtPaths): Promise<boolean> {
  const results: StepResult[] = [];
  for (const step of STEPS) {
    const result = await runStep(blender, paths, step.name);
    results.push(result);
    if (!result.ok && step.name === 'inspect') break;
  }
  console.log('\n[art] build-all summary');
  for (const r of results) {
    const status = r.skipped ? 'skipped' : r.ok ? 'ok' : 'FAILED';
    console.log(
      `  ${r.step.padEnd(12)} ${status.padEnd(8)} ${String(r.seconds).padStart(8)} s  ${r.warnings.length} warnings`,
    );
  }
  const summary = results.map(({ step, ok, skipped, seconds, warnings, errors }) => ({
    step,
    ok,
    skipped,
    seconds,
    warnings: warnings.length,
    errors,
  }));
  writeFileSync(join(paths.reportsDir, 'build-all.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return results.every((r) => r.ok);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const valid = [...STEPS.map((s) => s.name), 'build-all', 'test'];
  if (!arg || !valid.includes(arg)) {
    console.error(`usage: node tools/blender/run.ts <${valid.join('|')}>`);
    process.exit(2);
  }
  const blender = resolveBlender();
  if (arg === 'test') {
    const tests = join(TOOLS_DIR, 'tests', 'run_tests.py');
    process.exit(
      await runBlender(
        blender,
        ['--background', '--factory-startup', '--python-exit-code', '1', '--python', tests],
        'test',
      ),
    );
  }
  const paths = artPaths(REPO_ROOT, envSchema.parse(process.env).ART_PACKS_DIR);
  console.log(`[art] packs: ${paths.packsDir}`);
  const ok =
    arg === 'build-all'
      ? await buildAll(blender, paths)
      : (await runStep(blender, paths, arg as StepName)).ok;
  process.exit(ok ? 0 : 1);
}

await main();
