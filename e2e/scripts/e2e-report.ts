// E2E bookkeeping for CI (prompt 15), from Playwright's JSON reporter output.
//
//   node scripts/e2e-report.ts summary <results.json> [title]
//     Totals (passed / failed / flaky / skipped, wall time) and the list of flaky tests: tests
//     that failed first and passed on their CI retry. Printed, and appended to the GitHub job
//     summary when GITHUB_STEP_SUMMARY is set. Exit code 0: the test step itself fails the job.
//
//   node scripts/e2e-report.ts tags <list.json>
//     From `playwright test --list --reporter=json`: fails if any test lacks @full, the tag
//     every test carries (journeys add @smoke to the fast, read-only ones run after deploys).

import { appendFileSync, readFileSync } from 'node:fs';

interface JsonTest {
  projectName: string;
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  results: { status: string; retry: number; error?: { message?: string } }[];
}
interface JsonSpec {
  title: string;
  file: string;
  line: number;
  tags: string[];
  tests: JsonTest[];
}
interface JsonSuite {
  title: string;
  file: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}
interface JsonReport {
  suites: JsonSuite[];
  stats?: {
    duration: number;
    expected: number;
    unexpected: number;
    flaky: number;
    skipped: number;
  };
}

function* specsOf(suites: JsonSuite[], path: string[] = []): Generator<[JsonSpec, string]> {
  for (const suite of suites) {
    const here = suite.title && !suite.title.endsWith('.ts') ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) yield [spec, [...here, spec.title].join(' › ')];
    yield* specsOf(suite.suites ?? [], here);
  }
}

const read = (file: string): JsonReport => JSON.parse(readFileSync(file, 'utf8')) as JsonReport;

function summary(file: string, title = 'E2E'): void {
  const report = read(file);
  const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  const flaky: string[] = [];
  const failed: string[] = [];
  for (const [spec, name] of specsOf(report.suites)) {
    for (const test of spec.tests) {
      const label = `${name} [${test.projectName}] (${spec.file}:${spec.line})`;
      if (test.status === 'expected') counts.passed++;
      else if (test.status === 'skipped') counts.skipped++;
      else if (test.status === 'flaky') {
        counts.flaky++;
        flaky.push(label);
      } else {
        counts.failed++;
        failed.push(label);
      }
    }
  }
  const minutes = ((report.stats?.duration ?? 0) / 60_000).toFixed(1);
  const lines = [
    `### ${title}`,
    '',
    '| passed | failed | flaky | skipped | wall time |',
    '|---:|---:|---:|---:|---:|',
    `| ${counts.passed} | ${counts.failed} | ${counts.flaky} | ${counts.skipped} | ${minutes} min |`,
    '',
  ];
  if (flaky.length > 0) {
    lines.push(
      '**Flaky** (failed, then passed on the retry):',
      '',
      ...flaky.map((f) => `- ${f}`),
      '',
    );
  }
  if (failed.length > 0) lines.push('**Failed:**', '', ...failed.map((f) => `- ${f}`), '');
  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  // A flaky test is visible in the job's annotations, not only in the summary.
  for (const f of flaky) console.log(`::warning title=Flaky e2e test::${f}`);
}

function tags(file: string): void {
  const untagged: string[] = [];
  let total = 0;
  for (const [spec, name] of specsOf(read(file).suites)) {
    total++;
    // The JSON reporter lists tags without their '@'; accept both spellings.
    if (!spec.tags.some((t) => t.replace(/^@/, '') === 'full'))
      untagged.push(`${name} (${spec.file}:${spec.line})`);
  }
  if (untagged.length > 0) {
    console.error(`${untagged.length} of ${total} tests have no @full tag:`);
    for (const u of untagged) console.error(`  ${u}`);
    process.exit(1);
  }
  console.log(`All ${total} tests carry @full.`);
}

const [command, file, title] = process.argv.slice(2);
if (command === 'summary' && file) summary(file, title);
else if (command === 'tags' && file) tags(file);
else {
  console.error('usage: e2e-report.ts summary <results.json> [title] | tags <list.json>');
  process.exit(2);
}
