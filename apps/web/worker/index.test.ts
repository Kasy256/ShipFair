import { exports } from 'cloudflare:workers';
import { HealthResponse } from '@shipfair/shared';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { resetStub, stub } from './test/helpers.ts';

describe('web Worker', () => {
  it('GET /api/health checks the database and returns the version', async () => {
    await resetStub();
    const res = await exports.default.fetch('https://web.test/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(HealthResponse.parse(await res.json())).toMatchObject({
      ok: true,
      version: pkg.version,
      release: 'dev',
      environment: 'development',
      db: 'ok',
    });
  });

  it('GET /api/health is 503 when the database is down', async () => {
    await stub('/__mode', { method: 'POST', body: 'fail' });
    const res = await exports.default.fetch('https://web.test/api/health');
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json())).toMatchObject({ ok: false, db: 'down' });
    await resetStub();
  });

  it('unknown /api routes return the error shape', async () => {
    const res = await exports.default.fetch('https://web.test/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Route not found' } });
  });

  it('GET /api/dev/ping-realtime calls the realtime RPC binding', async () => {
    const res = await exports.default.fetch('https://web.test/api/dev/ping-realtime');
    expect(await res.json()).toEqual({ ok: true, reply: 'pong from realtime stub' });
  });

  it('WebRpc.ping answers', async () => {
    expect(await exports.WebRpc.ping()).toBe('pong from web');
  });
});
