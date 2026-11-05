import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from './app.ts';
import { ROUTES, type RouteContract } from './routes.ts';
import { resetStub } from './test/helpers.ts';

// Prompt 15 security pass: every route has a contract (routes.ts), and the running Worker keeps
// it. Unknown routes 404 through app.notFound, so they need no entry.

const contracts = ROUTES as Record<string, RouteContract>;
const served = [
  ...new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`)),
].sort();

const BOOTH = '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a10';
/** A concrete URL for a route pattern, with valid-looking params. */
const urlFor = (key: string, params: Record<string, string> = {}) => {
  const path = key
    .split(' ')[1]
    ?.replace(/:(\w+)/g, (_m, name: string) => params[name] ?? (name === 'id' ? BOOTH : 'x'))
    .replace('*', params['*'] ?? `u/${BOOTH}/${'0'.repeat(64)}.webp`);
  return `https://web.test${path}`;
};
const methodOf = (key: string) => key.split(' ')[0] ?? 'GET';
/** `:id` is a booth or user uuid, except where the contract says otherwise (report ids). */
const sampleParams = (key: string): Record<string, string> =>
  contracts[key]?.params?.safeParse({ id: BOOTH }).success === false ? { id: '1' } : {};
const call = (
  key: string,
  init: { token?: string; body?: unknown; params?: Record<string, string> } = {},
) => {
  const method = methodOf(key);
  const body = method === 'GET' ? undefined : init.body;
  return exports.default.fetch(urlFor(key, { ...sampleParams(key), ...init.params }), {
    method,
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
};

const byAuth = (auth: RouteContract['auth']) =>
  Object.entries(contracts)
    .filter(([, c]) => c.auth === auth)
    .map(([key]) => key);
const withBody = Object.entries(contracts)
  .filter(([, c]) => c.body && c.auth !== 'dev')
  .map(([key, c]) => [key, c] as const);

describe('route contracts', () => {
  beforeEach(resetStub);

  it('every served route has a contract, and every contract is served', () => {
    expect(served).toEqual(Object.keys(contracts).sort());
  });

  it('every route with path params declares their schema; every POST/PUT a body or a reason', () => {
    for (const [key, contract] of Object.entries(contracts)) {
      if (/[:*]/.test(key)) expect(contract.params, key).toBeDefined();
      if (/^(POST|PUT) /.test(key)) {
        expect(Boolean(contract.body) !== Boolean(contract.noBody), key).toBe(true);
      }
    }
  });

  it.each(byAuth('user'))('%s refuses anonymous calls (401)', async (key) => {
    const res = await call(key, { body: {} });
    expect(res.status).toBe(401);
  });

  it.each(byAuth('staff'))('%s refuses anonymous (401) and non-staff (403) calls', async (key) => {
    expect((await call(key, { body: {} })).status).toBe(401);
    expect((await call(key, { token: 'owner-token', body: {} })).status).toBe(403);
  });

  it.each(withBody)('%s rejects a body that fails its schema (400)', async (key, contract) => {
    const junk = { unexpected: true };
    expect(contract.body?.safeParse(junk).success).toBe(false);
    const token = contract.auth === 'staff' ? 'staff-token' : 'owner-token';
    const res = await call(key, { token, body: junk });
    expect(res.status).toBe(400);
  });

  it.each(
    Object.entries(contracts)
      .filter(([key, c]) => /:id/.test(key) && c.auth !== 'dev')
      .map(([key, c]) => [key, c] as const),
  )('%s rejects a malformed id without a 5xx', async (key, contract) => {
    const token = contract.auth === 'staff' ? 'staff-token' : 'owner-token';
    const res = await call(key, { token, params: { id: 'not-an-id' }, body: {} });
    expect([400, 404]).toContain(res.status);
  });
});
