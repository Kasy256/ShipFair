import { fakeWorld } from '@shipfair/shared/fake-world';

// Shared by vitest.config.ts (which builds the stub Workers) and the Worker tests.

/** ES256 key the auth stub publishes as Supabase's JWKS. Test-only; it signs nothing real. */
export const TEST_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'LZZXCVda8AQTyCIs_-BtfNUTLJW220BSMtM0iQDj49E',
  y: '4JWL4iF7ealE925emFePPKaQTLTQygPvY953ZquveyI',
  d: 'H4huD4aFjfprEUsrCHPiLgjbsvzJydxsCCK2U57UADw',
  kid: 'test-key-1',
  alg: 'ES256',
  use: 'sig',
} as const;

export const AUTH_URL = 'https://auth.test/auth/v1';
export const JWKS_URL = `${AUTH_URL}/.well-known/jwks.json`;
export const STATS_SECRET = 'test-stats-secret';

/** Users the web stub knows (`getPlayer`). */
export const USERS = {
  ada: '00000000-0000-4000-8000-0000000000a1',
  bob: '00000000-0000-4000-8000-0000000000a2',
  banned: '00000000-0000-4000-8000-0000000000b1',
  newbie: '00000000-0000-4000-8000-0000000000c1',
  noProfile: '00000000-0000-4000-8000-0000000000d1',
} as const;

/** The city every test shard loads: 12 booths over the launch districts. */
export const WORLD = fakeWorld(12, 1);
