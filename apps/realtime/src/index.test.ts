import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('realtime Worker', () => {
  it('GET /health returns ok', async () => {
    const res = await exports.default.fetch('https://rt.test/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown paths return the error shape', async () => {
    const res = await exports.default.fetch('https://rt.test/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Route not found' } });
  });

  it('GET /dev/ping-web calls the web RPC binding', async () => {
    const res = await exports.default.fetch('https://rt.test/dev/ping-web');
    expect(await res.json()).toEqual({ ok: true, reply: 'pong from web stub' });
  });

  it('RealtimeRpc.ping answers', async () => {
    expect(await exports.RealtimeRpc.ping()).toBe('pong from realtime');
  });

  it('RealtimeRpc.worldUpdate accepts booth ids (stub until prompt 10)', async () => {
    const id = '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a10';
    expect(await exports.RealtimeRpc.worldUpdate([id, 'not-an-id'])).toBe(1);
  });

  it('RealtimeRpc.kick accepts a user id (stub until prompt 10)', async () => {
    expect(await exports.RealtimeRpc.kick('00000000-0000-4000-8000-000000000001', 'banned')).toBe(
      true,
    );
    expect(await exports.RealtimeRpc.kick('nope', 'banned')).toBe(false);
  });
});
