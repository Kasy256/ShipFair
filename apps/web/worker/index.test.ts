import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

describe('web Worker', () => {
  it('GET /api/health returns ok and the version', async () => {
    const res = await exports.default.fetch('https://web.test/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: pkg.version });
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
