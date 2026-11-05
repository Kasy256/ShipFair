import * as z from 'zod';
import type { Env } from './env.ts';
import { runNightly } from './passport.ts';
import { serviceDb } from './service.ts';

// The web Worker's Cron Triggers (wrangler.jsonc `triggers.crons`, INFRASTRUCTURE.md §2). The
// SQL functions decide (migration `scheduled_jobs`); these only call them and log a JSON line
// per run for Workers Logs. A thrown error fails the run in the dashboard and reaches Sentry.

export const CRONS = {
  /** 03:00 UTC: booth tiers and passport evidence pruning (prompt 13). */
  nightly: '0 3 * * *',
  /** Every hour: R2 objects queued in `pending_media_deletes` 30+ days ago. */
  mediaCleanup: '0 * * * *',
  /** 03:30 UTC: report chat context older than 30 days, then the stats rollup check. */
  daily: '30 3 * * *',
} as const;

/** R2 deletes at most 1,000 keys per call. */
const MEDIA_BATCH = 500;
/** An hourly run stops after this many batches; the rest waits for the next hour. */
const MAX_MEDIA_BATCHES = 10;

const DueMedia = z.array(z.object({ id: z.number().int(), key: z.string().min(1) }));

export interface MediaCleanupResult {
  deleted: number;
  batches: number;
}

export async function cleanupMedia(env: Env): Promise<MediaCleanupResult> {
  const db = serviceDb(env);
  let deleted = 0;
  let batches = 0;
  while (batches < MAX_MEDIA_BATCHES) {
    const due = DueMedia.parse(await db.rpc('due_media_deletes', { max_rows: MEDIA_BATCH }));
    if (due.length === 0) break;
    batches++;
    // The approved copy and any leftover upload of the same file.
    const keys = due.flatMap((row) => [row.key, `pending/${row.key}`]);
    await env.MEDIA.delete(keys);
    const finished = z
      .number()
      .int()
      .parse(await db.rpc('finish_media_deletes', { ids: due.map((row) => row.id) }));
    deleted += finished;
    if (due.length < MEDIA_BATCH) break;
  }
  console.log(JSON.stringify({ event: 'media_cleanup', deleted, batches }));
  return { deleted, batches };
}

const StatsSanity = z.object({
  day: z.string(),
  rows: z.number().int(),
  visits: z.number(),
  tryClicks: z.number(),
  uniqueOverVisits: z.number().int(),
  futureRows: z.number().int(),
  gap: z.boolean(),
});
export type StatsSanity = z.infer<typeof StatsSanity>;

export interface DailyResult {
  purgedReports: number;
  stats: StatsSanity;
  /** Human-readable problems found by the stats check; empty when all is well. */
  problems: string[];
}

export function statsProblems(stats: StatsSanity): string[] {
  const problems: string[] = [];
  if (stats.gap) problems.push(`no visit stats for ${stats.day} after a day with visits`);
  if (stats.uniqueOverVisits > 0) {
    problems.push(`${stats.uniqueOverVisits} rows with more unique visitors than visits`);
  }
  if (stats.futureRows > 0) problems.push(`${stats.futureRows} rows dated in the future`);
  return problems;
}

export async function runDaily(env: Env): Promise<DailyResult> {
  const db = serviceDb(env);
  const purgedReports = z
    .number()
    .int()
    .parse(await db.rpc('purge_report_context', { keep_days: 30 }));
  const stats = StatsSanity.parse(await db.rpc('booth_stats_sanity', {}));
  const problems = statsProblems(stats);
  console.log(JSON.stringify({ event: 'daily_jobs', purgedReports, stats, problems }));
  return { purgedReports, stats, problems };
}

export class StatsSanityError extends Error {
  override name = 'StatsSanityError';
}

/** Runs the job for `cron`. Unknown schedules throw, so a typo in wrangler.jsonc is visible. */
export async function runScheduled(cron: string, env: Env): Promise<void> {
  switch (cron) {
    case CRONS.nightly:
      await runNightly(env);
      return;
    case CRONS.mediaCleanup:
      await cleanupMedia(env);
      return;
    case CRONS.daily: {
      const { problems } = await runDaily(env);
      // Thrown after the purge has run, so Sentry (and the cron dashboard) shows it.
      if (problems.length > 0) throw new StatsSanityError(problems.join('; '));
      return;
    }
    default:
      throw new Error(`No job for cron "${cron}"`);
  }
}
