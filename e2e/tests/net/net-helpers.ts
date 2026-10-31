import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { enterWorld } from '../engine/helpers.ts';

// Multiplayer e2e (prompt 11): the specs run their own realtime Worker (`wrangler dev` with the
// load-test web stub, so no Supabase is needed) on REALTIME_PORT, which they can kill and
// restart, and point pages at it with the dev-only `?realtime=` parameter. Bots come from
// tools/loadtest. State goes to a fresh temp dir, never the `pnpm dev` server's.

export const REALTIME_PORT = 8898;
export const REALTIME_HOST = `127.0.0.1:${REALTIME_PORT}`;
const INSPECTOR_PORT = 9242;
const REALTIME_DIR = fileURLToPath(new URL('../../../apps/realtime/', import.meta.url));
const ROOT_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const WRANGLER_JS = join(REALTIME_DIR, 'node_modules/wrangler/bin/wrangler.js');
const READY_TIMEOUT_MS = 120_000;

/** wrangler keeps Worker logs off stdout when it thinks an agent runs it; we only need "Ready". */
function plainEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(AI_AGENT|CLAUDECODE|CLAUDE_|CURSOR_|CODEX_)/.test(key)) delete env[key];
  }
  return env;
}

function stopTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || !child.pid) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGINT');
    }
  });
}

async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://${REALTIME_HOST}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export class RealtimeServer {
  readonly #persist = mkdtempSync(join(tmpdir(), 'shipfair-rt-e2e-'));
  #child: ChildProcess | null = null;

  async start(): Promise<void> {
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
        String(REALTIME_PORT),
        '--ip',
        '127.0.0.1',
        '--inspector-port',
        String(INSPECTOR_PORT),
        '--persist-to',
        this.#persist,
        '--var',
        'STATS_INGEST_SECRET:e2e',
        '--show-interactive-dev-session=false',
      ],
      { cwd: REALTIME_DIR, env: plainEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.#child = child;
    child.stdout?.resume();
    child.stderr?.resume();
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!(await isHealthy())) {
      if (child.exitCode !== null) throw new Error(`wrangler dev exited (${child.exitCode})`);
      if (Date.now() > deadline) throw new Error('the realtime server did not start in 120 s');
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async stop(): Promise<void> {
    const child = this.#child;
    this.#child = null;
    if (child) await stopTree(child);
    // The port must be free before a restart.
    const deadline = Date.now() + 20_000;
    while ((await isHealthy()) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 250));
  }
}

/** Waits until the shards report at least `players` connected (the bots finished joining). */
export async function waitForPlayers(players: number, timeoutMs = 60_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://${REALTIME_HOST}/health`);
      const body = (await res.json()) as { totals: { players: number } };
      if (body.totals.players >= players) return body.totals.players;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error(`fewer than ${players} players after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** `count` guest bots from tools/loadtest walking near the plaza for `durationS` seconds. */
export function startBots(count: number, durationS: number): { stop(): Promise<void> } {
  const child = spawn(
    process.execPath,
    [
      'tools/loadtest/run.ts',
      '--no-spawn',
      '--host',
      REALTIME_HOST,
      '--guests-only',
      '--bots',
      String(count),
      '--duration',
      String(durationS),
      '--ramp',
      '2',
      '--workers',
      '1',
    ],
    { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout?.resume();
  child.stderr?.resume();
  return { stop: () => stopTree(child) };
}

/**
 * Opens the fake 60-booth city connected to the e2e realtime server in test mode, enters it and
 * waits until the client is online. Pages are stepped by hand: a page left on rAF under
 * SwiftShader ran at ~1 fps on the dev laptop and starved its own fetches (joins timed out at
 * 20 s). Remote players still interpolate on the real clock, so stepping one frame before a
 * sample shows them where a real-time page would.
 */
export async function openConnected(page: Page, opts: { query?: string } = {}) {
  // Realtime warnings (join failures, dropped frames) explain a page that never comes online.
  page.on('console', (m) => {
    if (m.type() === 'warning' && m.text().startsWith('Realtime'))
      console.log(`[page] ${m.text()}`);
  });
  const extra = opts.query ? `&${opts.query}` : '';
  await page.goto(`/?test&debug=fake60&quality=low&realtime=${REALTIME_HOST}${extra}`);
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-status', 'ready', {
    timeout: 60_000,
  });
  await page.waitForFunction(() => window.__shipfair !== undefined);
  await enterWorld(page);
  await page.evaluate(() => window.__shipfair?.assets.ready());
  // A stepped page only sends moves while frames run; announce the spawn position.
  await page.evaluate(() => window.__shipfair?.step(1 / 60, 2));
  // A fresh server answering 20 bots at once can be slow: the client's join backoff absorbs it.
  await expect(page.getByTestId('net-pill')).toHaveAttribute('data-status', 'online', {
    timeout: 60_000,
  });
}
