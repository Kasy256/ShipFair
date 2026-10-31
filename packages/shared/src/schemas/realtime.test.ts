import { describe, expect, it } from 'vitest';
import { RealtimeEnv } from './env.ts';
import { PlayerRecord, StatsBatch } from './realtime.ts';

const BOOTH = '6f1c1e5e-3f7a-4c39-9a51-5d2b8f0d7a10';
const USER = '00000000-0000-4000-8000-000000000001';

describe('StatsBatch', () => {
  const batch = {
    shard: 'w-1',
    secret: 'stats',
    rows: [{ boothId: BOOTH, day: '2026-10-31', visits: 3, uniqueVisitors: 2 }],
  };

  it('accepts a well-formed batch', () => {
    expect(StatsBatch.safeParse(batch).success).toBe(true);
  });

  it('refuses bad days, negative counts, unknown shard names and a missing secret', () => {
    const row = batch.rows[0];
    expect(StatsBatch.safeParse({ ...batch, rows: [{ ...row, day: '31/10/2026' }] }).success).toBe(
      false,
    );
    expect(StatsBatch.safeParse({ ...batch, rows: [{ ...row, visits: -1 }] }).success).toBe(false);
    expect(StatsBatch.safeParse({ ...batch, rows: [{ ...row, visits: 1.5 }] }).success).toBe(false);
    expect(StatsBatch.safeParse({ ...batch, shard: 'main' }).success).toBe(false);
    expect(StatsBatch.safeParse({ ...batch, secret: '' }).success).toBe(false);
  });
});

describe('PlayerRecord', () => {
  it('accepts a profile or null, and needs the ban flag', () => {
    const profile = {
      id: USER,
      handle: 'ada',
      displayName: 'Ada',
      avatarStyle: {},
      createdAt: '2026-10-01T09:00:00+00:00',
    };
    expect(PlayerRecord.safeParse({ profile, banned: false }).success).toBe(true);
    expect(PlayerRecord.safeParse({ profile: null, banned: true }).success).toBe(true);
    expect(PlayerRecord.safeParse({ profile }).success).toBe(false);
  });
});

describe('RealtimeEnv TICK_MODE', () => {
  const base = {
    ENVIRONMENT: 'development',
    SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
    STATS_INGEST_SECRET: 'stats',
  };

  it('defaults to the interval timer and accepts manual for tests', () => {
    expect(RealtimeEnv.parse(base).TICK_MODE).toBe('interval');
    expect(RealtimeEnv.parse({ ...base, TICK_MODE: 'manual' }).TICK_MODE).toBe('manual');
    expect(RealtimeEnv.safeParse({ ...base, TICK_MODE: 'fast' }).success).toBe(false);
  });
});
