import { parentPort, workerData } from 'node:worker_threads';
import { rng } from '@shipfair/shared';
import { Bot, type BotStats, emptyStats } from './bot.ts';

// One group of bots on its own thread (run.ts starts several), so the bots' own CPU use doesn't
// throttle the shards they are measuring. run.ts posts 'steady' when every group has joined and
// 'stop' at the end; the worker answers 'ramped' and then its stats.

export interface BotJob {
  readonly host: string;
  readonly protocol: 'http' | 'https';
  readonly seed: number;
  readonly rampMs: number;
  readonly bots: readonly { readonly guestId: string; readonly token?: string }[];
}

export type WorkerReply =
  | { readonly type: 'ramped' }
  | { readonly type: 'stats'; readonly stats: BotStats[]; readonly shards: string[] };

const job = workerData as BotJob;
const port = parentPort;
if (!port) throw new Error('bot-worker.ts runs as a worker thread (see run.ts)');

const random = rng(job.seed);
const bots: Bot[] = [];
const stats: BotStats[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ramp(): Promise<void> {
  for (const spec of job.bots) {
    const s = emptyStats();
    const bot = new Bot({
      host: job.host,
      protocol: job.protocol,
      guestId: spec.guestId,
      ...(spec.token ? { token: spec.token } : {}),
      random,
      stats: s,
    });
    bots.push(bot);
    stats.push(s);
    void bot.start();
    await sleep(job.rampMs / Math.max(1, job.bots.length));
  }
  port?.postMessage({ type: 'ramped' } satisfies WorkerReply);
}

port.on('message', (message: 'steady' | 'stop') => {
  if (message === 'steady') {
    for (const s of stats) {
      s.snapTimes.length = 0; // measure intervals in steady state only
      s.snapServerTimes.length = 0;
    }
    return;
  }
  const shards = bots.map((b) => b.shard).filter(Boolean);
  for (const bot of bots) bot.stop();
  port.postMessage({ type: 'stats', stats, shards } satisfies WorkerReply);
});

void ramp();
