import type { AssetStats, GeneratedAssetManifest } from '@shipfair/shared';
import type { Report, Sink } from './sink.ts';

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const status = (s: AssetStats, isPlaceholder: boolean) =>
  `${s.isOverBudget ? 'OVER' : 'ok'}${isPlaceholder ? ' (placeholder)' : ''}`;

function row(name: string, s: AssetStats, isPlaceholder: boolean, extra = ''): string {
  return `  ${pad(name, 34)}${pad(s.triangles, 8)}${pad(kb(s.bytes), 11)}${pad(s.bones || '', 5)}${pad(status(s, isPlaceholder), 18)}${extra}`;
}

/** Prints the per-asset table, totals and every problem, grouped. */
export function printSummary(
  m: GeneratedAssetManifest,
  report: Report,
  sink: Sink,
  ms: number,
  isCi: boolean,
): void {
  const lines = [
    `  ${pad('asset', 34)}${pad('tris', 8)}${pad('size', 11)}${pad('bones', 5)}status`,
  ];
  for (const c of m.characters) {
    lines.push(row(c.id, c.stats, c.isPlaceholder));
    lines.push(
      row(
        `${c.id}_lod1`,
        c.lod1.stats,
        c.isPlaceholder,
        `error ${c.lod1.error}${c.lod1.isHandMade ? ' hand-made' : ''}`,
      ),
    );
  }
  lines.push(
    row(
      'humanoid_clips',
      m.animations.stats,
      m.animations.isPlaceholder,
      `${m.animations.clips.length} clips`,
    ),
  );
  lines.push(
    row(
      'booth_kit',
      m.boothKit.stats,
      m.boothKit.isPlaceholder,
      `${m.boothKit.tiers.length} tiers, AO ${m.boothKit.aoAttribute ?? 'none'}`,
    ),
  );
  for (const p of m.props) lines.push(row(p.id, p.stats, p.isPlaceholder, p.collider));
  const wardrobeBytes = m.wardrobe.reduce((sum, w) => sum + w.stats.bytes + w.lod1.stats.bytes, 0);
  const total = [...sink.files.values()].reduce((sum, b) => sum + b.length, 0);
  console.log(lines.join('\n'));
  console.log(`\n  wardrobe: ${m.wardrobe.length} item files (+ LOD1), ${kb(wardrobeBytes)}`);
  console.log(`  output: ${sink.files.size} files, ${kb(total)} in ${(ms / 1000).toFixed(1)} s\n`);
  for (const line of report.info) console.log(`info: ${line}`);
  for (const line of report.warnings) console.warn(`warning: ${line}`);
  const budgetLabel = isCi ? 'error (budget)' : 'warning (budget, fails in CI)';
  for (const line of report.budget) console.warn(`${budgetLabel}: ${line}`);
  for (const line of report.errors) console.error(`error: ${line}`);
  console.log(
    `\n${report.errors.length} errors, ${report.budget.length} over budget, ${report.warnings.length} warnings`,
  );
}
