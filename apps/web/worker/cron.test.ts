import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import wrangler from '../wrangler.jsonc?raw';
import { CRONS, cleanupMedia, runDaily, runScheduled, StatsSanityError } from './cron.ts';
import type { Env } from './env.ts';
import worker from './index.ts';
import { resetStub, seed, table } from './test/helpers.ts';

const OWNER = '00000000-0000-4000-8000-000000000001';
const key = (n: number) => `u/${OWNER}/${String(n).padStart(64, '0')}.webp`;
const media = (env as Env).MEDIA;

describe('cron schedules', () => {
  it('wrangler.jsonc registers exactly the jobs cron.ts runs', () => {
    const crons = wrangler.match(/"crons":\s*\[([^\]]*)\]/)?.[1]?.match(/"[^"]+"/g);
    expect(crons?.map((c) => JSON.parse(c)).sort()).toEqual(Object.values(CRONS).sort());
  });

  it('an unknown schedule fails loudly', async () => {
    await expect(runScheduled('5 4 * * *', env as Env)).rejects.toThrow(/No job for cron/);
  });
});

describe('R2 media cleanup', () => {
  beforeEach(resetStub);

  it('deletes due objects (and their pending copies), then forgets the rows', async () => {
    await media.put(key(1), 'a');
    await media.put(`pending/${key(1)}`, 'a');
    await media.put(key(2), 'b');
    await media.put(key(3), 'kept');
    await seed({
      media_queue: [
        { id: 1, key: key(1), due: true },
        { id: 2, key: key(2), due: true },
        { id: 3, key: key(3), due: false },
      ],
    });

    expect(await cleanupMedia(env as Env)).toEqual({ deleted: 2, batches: 1 });
    expect(await media.head(key(1))).toBeNull();
    expect(await media.head(`pending/${key(1)}`)).toBeNull();
    expect(await media.head(key(2))).toBeNull();
    expect(await media.head(key(3))).not.toBeNull();
    expect(await table('media_queue')).toEqual([{ id: 3, key: key(3), due: false }]);
  });

  it('runs hourly from the scheduled handler, and does nothing on an empty queue', async () => {
    const controller = { scheduledTime: Date.now(), cron: CRONS.mediaCleanup, noRetry() {} };
    await worker.scheduled(controller, env as Env);
    expect(await cleanupMedia(env as Env)).toEqual({ deleted: 0, batches: 0 });
  });
});

describe('daily jobs', () => {
  beforeEach(resetStub);

  it('purges report context and passes a healthy stats rollup', async () => {
    await seed({ report_contexts: 4 });
    const result = await runDaily(env as Env);
    expect(result.purgedReports).toBe(4);
    expect(result.problems).toEqual([]);
    expect(result.stats.visits).toBe(12);
  });

  it('a gap in the rollup fails the run after the purge has happened', async () => {
    await seed({
      report_contexts: 1,
      stats_sanity: {
        day: '2026-11-04',
        rows: 0,
        visits: 0,
        tryClicks: 0,
        uniqueOverVisits: 2,
        futureRows: 0,
        gap: true,
      },
    });
    const controller = { scheduledTime: Date.now(), cron: CRONS.daily, noRetry() {} };
    const run = worker.scheduled(controller, env as Env);
    await expect(run).rejects.toBeInstanceOf(StatsSanityError);
    await expect(run).rejects.toThrow(
      'no visit stats for 2026-11-04 after a day with visits; 2 rows with more unique visitors than visits',
    );
    // The purge still ran: a second run finds nothing left.
    expect((await runDaily(env as Env)).purgedReports).toBe(0);
  });
});
