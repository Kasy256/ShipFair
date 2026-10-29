import { exports } from 'cloudflare:workers';
import { WorldSnapshot } from '@shipfair/shared';
import { beforeEach, describe, expect, it } from 'vitest';

// Supabase is the stub in test/supabase-stub.mjs (miniflare outboundService).
const stub = (path: string, init?: RequestInit) => fetch(`http://supabase.test${path}`, init);
const restCalls = async () => ((await (await stub('/__calls')).json()) as { calls: number }).calls;
const getWorld = () => exports.default.fetch('https://web.test/api/world');

describe('GET /api/world', () => {
  beforeEach(async () => {
    await stub('/__mode', { method: 'POST', body: 'ok' });
    // A new version is a new cache key, so each test starts cold.
    await exports.WebRpc.purgeWorld();
  });

  it('returns a valid snapshot of districts, approved booths and makers', async () => {
    const res = await getWorld();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const world = WorldSnapshot.parse(await res.json());
    expect(world.districts.map((d) => d.slug)).toEqual(['ai-agents', 'dev-tools']);
    // The stub's invalid row (http URL) is dropped, not sent and not fatal.
    expect(world.booths.map((b) => b.slug)).toEqual([
      'example-pretend-pilot',
      'example-quote-maker',
    ]);
    expect(world.makers).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        handle: 'maker1',
        displayName: 'Maker One',
        links: { github: 'maker1' },
      },
    ]);
    expect(world.version).toBeGreaterThan(0);
  });

  it('sets the cache headers and serves repeats from the edge cache', async () => {
    const first = await getWorld();
    expect(first.headers.get('cache-control')).toBe(
      'public, max-age=30, stale-while-revalidate=300',
    );
    expect(first.headers.get('x-world-cache')).toBe('miss');
    await first.arrayBuffer();
    // districts + booths + makers
    const readsAfterMiss = await restCalls();
    expect(readsAfterMiss).toBe(3);

    const second = await getWorld();
    expect(second.headers.get('x-world-cache')).toBe('hit');
    expect(second.headers.get('cache-control')).toBe(first.headers.get('cache-control'));
    expect(WorldSnapshot.parse(await second.json()).booths).toHaveLength(2);
    expect(await restCalls()).toBe(readsAfterMiss);
  });

  it('purgeWorld bumps the version and the next request reads Postgres again', async () => {
    const before = WorldSnapshot.parse(await (await getWorld()).json());
    const version = await exports.WebRpc.purgeWorld();
    expect(version).toBe(before.version + 1);
    const res = await getWorld();
    expect(res.headers.get('x-world-cache')).toBe('miss');
    expect(WorldSnapshot.parse(await res.json()).version).toBe(version);
  });

  it('answers 503 with the error shape when Supabase is down', async () => {
    await stub('/__mode', { method: 'POST', body: 'fail' });
    const res = await getWorld();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'world_unavailable', message: 'Supabase answered 500' },
    });
  });

  it('sends the security headers', async () => {
    const res = await getWorld();
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('https://challenges.cloudflare.com');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
