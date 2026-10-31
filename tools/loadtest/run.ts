import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';
import { rng } from '@shipfair/shared';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { type BotStats, emptyStats } from './bot.ts';
import type { BotJob, WorkerReply } from './bot-worker.ts';

// Realtime load test (prompt 10). Spawns `wrangler dev` with the realtime Worker and a stub web
// Worker (web-stub.ts, so no Supabase is needed), serves a JWKS for the signed-in bots, runs N bot
// clients, and reports what the shards logged (`shard_metrics` lines) and what the bots saw.
//
//   node tools/loadtest/run.ts --bots 300 --duration 180
//   node tools/loadtest/run.ts --no-spawn --host rt-staging.shipfair.xyz --https --guests-only

const { values: args } = parseArgs({
  options: {
    bots: { type: 'string', default: '300' },
    duration: { type: 'string', default: '180' }, // seconds of steady state after ramp-up
    ramp: { type: 'string', default: '30' }, // seconds over which bots join
    'signed-in': { type: 'string', default: '0.4' }, // share of bots with a token (they chat)
    host: { type: 'string', default: '127.0.0.1:8899' },
    https: { type: 'boolean', default: false },
    'no-spawn': { type: 'boolean', default: false },
    'guests-only': { type: 'boolean', default: false },
    seed: { type: 'string', default: '10' },
    workers: { type: 'string', default: '3' }, // bot threads
    log: { type: 'string' }, // file that receives everything wrangler dev prints
  },
});

const BOTS = Number(args.bots);
const DURATION_S = Number(args.duration);
const RAMP_S = Number(args.ramp);
const SIGNED_IN = args['guests-only'] ? 0 : Number(args['signed-in']);
const HOST = args.host;
const JWKS_PORT = 8791;
const ISSUER = `http://127.0.0.1:${JWKS_PORT}/auth/v1`;
const REALTIME_DIR = fileURLToPath(new URL('../../apps/realtime/', import.meta.url));
const WRANGLER_JS = fileURLToPath(
  new URL('../../apps/realtime/node_modules/wrangler/bin/wrangler.js', import.meta.url),
);

interface ShardMetrics {
  shard: string;
  players: number;
  msgsIn: number;
  msgsOut: number;
  bytesOut: number;
  snaps: number;
  snapEntriesAvg: number;
  snapBytesPerPlayer: number;
  ticks: number;
  tickP50Ms: number;
  tickP95Ms: number;
  tickMaxMs: number;
  invalid: number;
  dropped: number;
  clamped: number;
  periodS: number;
  /** Local receive time, to keep only steady-state windows. */
  at: number;
}

const metrics: ShardMetrics[] = [];
let ingestCalls = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
}

async function startJwks(): Promise<(sub: string) => Promise<string>> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'loadtest', alg: 'ES256', use: 'sig' };
  const server = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(JWKS_PORT, '127.0.0.1', resolve));
  server.unref();
  return (sub) =>
    new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'loadtest' })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(privateKey);
}

/** One `{"event":…}` log line from the Worker; `at` is when it was logged (ms). */
function onEvent(text: string, at: number): void {
  const start = text.indexOf('{"event":');
  if (start < 0) return;
  try {
    const event = JSON.parse(text.slice(start)) as { event: string } & ShardMetrics;
    if (event.event === 'shard_metrics') metrics.push({ ...event, at });
    if (event.event === 'ingest') ingestCalls++;
  } catch {
    // A log line that only looked like ours.
  }
}

/**
 * Worker logs from wrangler's local log store. When wrangler decides it runs under an AI agent it
 * keeps console output out of its stdout and only stores it there, queryable with SQL.
 */
async function readStoredLogs(sinceMs: number): Promise<number> {
  const scheme = args.https ? 'https' : 'http';
  const sql =
    `SELECT ts_ms, message FROM logs WHERE ts_ms >= ${Math.floor(sinceMs)} ` +
    `AND (message LIKE '%shard_metrics%' OR message LIKE '%ingest%') ORDER BY ts_ms`;
  try {
    const url = `${scheme}://${HOST}/cdn-cgi/local/explorer/api/local/observability/query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const body = (await res.json()) as { result?: { rows?: [number, string][] } };
    const rows = body.result?.rows ?? [];
    for (const [ts, message] of rows) {
      // Stored as a JSON array of console.log arguments, e.g. ["[shipfair-realtime]", "{…}"].
      const parts = JSON.parse(message) as unknown;
      for (const part of Array.isArray(parts) ? parts : [parts]) {
        if (typeof part === 'string') onEvent(part, ts);
      }
    }
    return rows.length;
  } catch (error) {
    console.error('could not read the local log store', error);
    return 0;
  }
}

/**
 * The environment for wrangler without coding-agent markers: wrangler keeps Worker console output
 * off stdout when it thinks an AI agent runs it, and this script reads metrics from stdout.
 */
function wranglerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(AI_AGENT|CLAUDECODE|CLAUDE_|CURSOR_|CODEX_)/.test(key)) delete env[key];
  }
  return env;
}

async function startWrangler(): Promise<ChildProcess> {
  if (args.log) writeFileSync(args.log, '');
  const port = HOST.split(':')[1] ?? '8899';
  // Node runs wrangler directly (no pnpm or shell in between), so `child.pid` is wrangler itself
  // and stopTree can take down its workerd processes with it.
  const child = spawn(
    process.execPath,
    [
      WRANGLER_JS,
      'dev',
      '-c',
      'wrangler.jsonc',
      '-c',
      '../../tools/loadtest/web-stub.wrangler.jsonc',
      '--port',
      port,
      '--inspector-port',
      '9241',
      '--var',
      `SUPABASE_JWKS_URL:${ISSUER}/.well-known/jwks.json`,
      '--var',
      'STATS_INGEST_SECRET:loadtest',
      '--show-interactive-dev-session=false',
    ],
    { cwd: REALTIME_DIR, env: wranglerEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let ready: () => void = () => {};
  const isReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let buffer = '';
  const read = (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.includes('Ready on')) ready();
      if (args.log) appendFileSync(args.log, `${line}\n`);
      onEvent(line, Date.now());
      nl = buffer.indexOf('\n');
    }
  };
  child.stdout?.on('data', read);
  child.stderr?.on('data', read);
  await Promise.race([
    isReady,
    sleep(120_000).then(() => {
      throw new Error('wrangler dev did not become ready in 120 s');
    }),
  ]);
  return child;
}

function stopTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGINT');
  }
}

interface Merged extends BotStats {
  /** Arrival gaps between any two snaps (includes ticks where nobody nearby changed). */
  intervals: number[];
  /** Arrival gaps between snaps from consecutive server ticks: delivery jitter only. */
  tickIntervals: number[];
  /** Server-side gaps between consecutive ticks that sent this bot a snap. */
  serverTickGaps: number[];
}

const TICK_MS = 100;

function merge(all: BotStats[]): Merged {
  const total: Merged = { ...emptyStats(), intervals: [], tickIntervals: [], serverTickGaps: [] };
  for (const s of all) {
    for (let i = 1; i < s.snapTimes.length; i++) {
      const arrival = (s.snapTimes[i] ?? 0) - (s.snapTimes[i - 1] ?? 0);
      const server = (s.snapServerTimes[i] ?? 0) - (s.snapServerTimes[i - 1] ?? 0);
      total.intervals.push(arrival);
      // Consecutive ticks are ~100 ms apart on the server's clock (setInterval drift allowed).
      if (server <= TICK_MS * 1.5) {
        total.tickIntervals.push(arrival);
        total.serverTickGaps.push(server);
      }
    }
    total.snapBytes += s.snapBytes;
    total.snapEntries += s.snapEntries;
    total.framesIn += s.framesIn;
    total.bytesIn += s.bytesIn;
    total.framesOut += s.framesOut;
    total.corrections += s.corrections;
    total.shardFull += s.shardFull;
    total.joinErrors += s.joinErrors;
    total.chatsHeard += s.chatsHeard;
    for (const [code, n] of Object.entries(s.closes)) {
      total.closes[code] = (total.closes[code] ?? 0) + n;
    }
  }
  return total;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const sign = await startJwks();
  const wrangler = args['no-spawn'] ? null : await startWrangler();
  const random = rng(Number(args.seed));
  const workerCount = Math.max(1, Math.min(Number(args.workers), BOTS));

  // Bots are split over worker threads; tokens are signed here, where the JWKS key lives.
  const groups: { guestId: string; token?: string }[][] = Array.from(
    { length: workerCount },
    () => [],
  );
  for (let i = 0; i < BOTS; i++) {
    const isSignedIn = random() < SIGNED_IN;
    groups[i % workerCount]?.push({
      guestId: randomUUID(),
      ...(isSignedIn ? { token: await sign(randomUUID()) } : {}),
    });
  }
  console.log(
    `ramping ${BOTS} bots over ${RAMP_S} s on ${workerCount} threads (${Math.round(SIGNED_IN * 100)}% signed in)`,
  );
  const workers = groups.map(
    (bots, i) =>
      new Worker(new URL('./bot-worker.ts', import.meta.url), {
        workerData: {
          host: HOST,
          protocol: args.https ? 'https' : 'http',
          seed: Number(args.seed) + i + 1,
          rampMs: RAMP_S * 1000,
          bots,
        } satisfies BotJob,
      }),
  );
  const reply = (worker: Worker, type: WorkerReply['type']) =>
    new Promise<WorkerReply>((resolve, reject) => {
      const onMessage = (msg: WorkerReply) => {
        if (msg.type !== type) return;
        worker.off('message', onMessage);
        resolve(msg);
      };
      worker.on('message', onMessage);
      worker.once('error', reject);
    });
  await Promise.all(workers.map((w) => reply(w, 'ramped')));
  const steadyFrom = Date.now();
  console.log(`steady state for ${DURATION_S} s`);
  for (const w of workers) w.postMessage('steady');
  await sleep(DURATION_S * 1000);
  const results = await Promise.all(
    workers.map((w) => {
      const done = reply(w, 'stats');
      w.postMessage('stop');
      return done;
    }),
  );
  const stats: BotStats[] = [];
  const shardList: string[] = [];
  for (const r of results) {
    if (r.type !== 'stats') continue;
    stats.push(...r.stats);
    shardList.push(...r.shards);
  }
  const snapshot = merge(stats);
  await sleep(2000);
  await Promise.all(workers.map((w) => w.terminate()));
  if (wrangler && metrics.length === 0) await readStoredLogs(startedAt);
  if (wrangler) stopTree(wrangler);

  // Metric windows are 60 s per shard; keep those that ended in steady state.
  const steady = metrics.filter(
    (m) => m.at - m.periodS * 1000 >= steadyFrom - 5000 && m.players > 0,
  );
  const shards = new Set(shardList);
  const perWindow = (pick: (m: ShardMetrics) => number) =>
    steady.reduce((sum, m) => sum + pick(m) / m.periodS, 0) /
    Math.max(1, new Set(steady.map((m) => Math.round(m.at / 60_000))).size);
  const playersAvg = steady.length
    ? steady.reduce((s, m) => s + m.players, 0) /
      new Set(steady.map((m) => Math.round(m.at / 60_000))).size
    : 0;
  const msgsInPerS = perWindow((m) => m.msgsIn);
  const msgsOutPerS = perWindow((m) => m.msgsOut);
  const bytesOutPerS = perWindow((m) => m.bytesOut);
  const entries = steady.reduce((s, m) => s + m.snaps * m.snapEntriesAvg, 0);
  const snapBytes = steady.reduce(
    (s, m) => s + m.snaps * m.snapEntriesAvg * m.snapBytesPerPlayer,
    0,
  );
  const tickP95s = steady.map((m) => m.tickP95Ms);

  const report = {
    bots: BOTS,
    signedInShare: SIGNED_IN,
    durationS: DURATION_S,
    shardsCreated: shards.size,
    shardNames: [...shards].sort(),
    metricWindows: steady.length,
    tickP50Ms: percentile(
      steady.map((m) => m.tickP50Ms),
      0.5,
    ),
    tickP95MsWorstShard: Math.max(0, ...tickP95s),
    tickP95MsMedianShard: percentile(tickP95s, 0.5),
    tickMaxMs: Math.max(0, ...steady.map((m) => m.tickMaxMs)),
    clientSnapIntervalP50Ms: Math.round(percentile(snapshot.tickIntervals, 0.5)),
    clientSnapIntervalP95Ms: Math.round(percentile(snapshot.tickIntervals, 0.95)),
    serverTickGapP95Ms: Math.round(percentile(snapshot.serverTickGaps, 0.95)),
    rawSnapGapP50Ms: Math.round(percentile(snapshot.intervals, 0.5)),
    rawSnapGapP95Ms: Math.round(percentile(snapshot.intervals, 0.95)),
    consecutiveTickShare:
      Math.round((snapshot.tickIntervals.length / Math.max(1, snapshot.intervals.length)) * 100) /
      100,
    serverMsgsInPerS: Math.round(msgsInPerS),
    serverMsgsOutPerS: Math.round(msgsOutPerS),
    serverBytesOutPerS: Math.round(bytesOutPerS),
    avgPlayersOnline: Math.round(playersAvg),
    msgsInPerPlayerHour: playersAvg ? Math.round((msgsInPerS / playersAvg) * 3600) : 0,
    msgsOutPerPlayerHour: playersAvg ? Math.round((msgsOutPerS / playersAvg) * 3600) : 0,
    avgSnapBytesPerPlayer: entries ? Math.round((snapBytes / entries) * 100) / 100 : 0,
    clientSnapBytesPerEntry: snapshot.snapEntries
      ? Math.round((snapshot.snapBytes / snapshot.snapEntries) * 100) / 100
      : 0,
    invalid: steady.reduce((s, m) => s + m.invalid, 0),
    dropped: steady.reduce((s, m) => s + m.dropped, 0),
    clamped: steady.reduce((s, m) => s + m.clamped, 0),
    clientCorrections: snapshot.corrections,
    shardFullNotices: snapshot.shardFull,
    joinErrors: snapshot.joinErrors,
    unexpectedCloses: snapshot.closes,
    chatsHeard: snapshot.chatsHeard,
    ingestStatsCalls: ingestCalls,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
