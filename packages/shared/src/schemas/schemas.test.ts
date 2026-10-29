import { describe, expect, it } from 'vitest';
import { ApiError, HealthResponse, WorldRequestQuery, WorldResponse } from './api.ts';
import { BoothDraftInput, BoothPublic } from './booth.ts';
import { District } from './district.ts';
import { RealtimeEnv, WebBuildEnv, WebWorkerEnv } from './env.ts';
import { GuestbookEntry } from './guestbook.ts';
import { AvatarStyle, ProfilePublic } from './profile.ts';
import { ReportInput } from './report.ts';
import { WorldSnapshot } from './world.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const district = {
  id: 1,
  slug: 'ai-agents',
  name: 'AI Agents',
  theme: 'ai-agents',
  color: '#7C3AED',
  sortOrder: 0,
};

const boothPublic = {
  id: uuid(1),
  ownerId: uuid(2),
  slug: 'my-cool-app',
  name: 'My Cool App',
  tagline: 'Ships your side project in a weekend',
  description: null,
  url: 'https://example.com',
  districtId: 1,
  logoKey: `u/${uuid(2)}/logo.webp`,
  media: [{ type: 'image', key: `u/${uuid(2)}/shot-1.webp`, w: 1280, h: 720 }],
  pricing: 'freemium',
  tier: 'stall',
  // Supabase's timestamptz format: microseconds and an explicit offset.
  approvedAt: '2026-10-26T09:30:00.123456+00:00',
};

describe('District', () => {
  it('parses a row and rejects bad colours and slugs', () => {
    expect(District.parse(district)).toEqual(district);
    expect(District.safeParse({ ...district, color: 'purple' }).success).toBe(false);
    expect(District.safeParse({ ...district, slug: 'AI Agents' }).success).toBe(false);
    expect(District.safeParse({ ...district, id: 0 }).success).toBe(false);
  });
});

describe('BoothPublic', () => {
  it('parses an approved booth', () => {
    expect(BoothPublic.parse(boothPublic)).toEqual(boothPublic);
  });

  it.each([
    ['http url', { url: 'http://example.com' }],
    ['javascript url', { url: 'javascript:alert(1)' }],
    ['short tagline', { tagline: 'too short' }],
    ['long name', { name: 'x'.repeat(41) }],
    ['bad tier', { tier: 'mega' }],
    ['six media', { media: Array.from({ length: 6 }, () => boothPublic.media[0]) }],
    ['media key with ..', { logoKey: '../../etc/passwd' }],
    ['absolute media key', { logoKey: '/etc/passwd' }],
    ['missing approvedAt', { approvedAt: undefined }],
  ])('rejects %s', (_, patch) => {
    expect(BoothPublic.safeParse({ ...boothPublic, ...patch }).success).toBe(false);
  });
});

describe('BoothDraftInput', () => {
  it('fills defaults and trims text', () => {
    const draft = BoothDraftInput.parse({
      slug: 'my-cool-app',
      name: '  My Cool App ',
      tagline: 'Ships your side project in a weekend',
      url: 'https://example.com',
      districtId: 2,
    });
    expect(draft).toEqual({
      slug: 'my-cool-app',
      name: 'My Cool App',
      tagline: 'Ships your side project in a weekend',
      url: 'https://example.com',
      districtId: 2,
      media: [],
    });
  });
});

describe('AvatarStyle and ProfilePublic', () => {
  it('turns the jsonb default {} into a full style', () => {
    const style = AvatarStyle.parse({});
    expect(Object.keys(style).sort()).toEqual(['accessory', 'bottom', 'hair', 'skin', 'top']);
    expect(AvatarStyle.parse({ hair: 'bun', extra: 1 })).toEqual({ ...style, hair: 'bun' });
  });

  it('defaults a missing avatar and links, and validates handles', () => {
    const profile = ProfilePublic.parse({ id: uuid(3), handle: 'ada_l', displayName: 'Ada' });
    expect(profile.avatarStyle).toEqual(AvatarStyle.parse({}));
    expect(profile.links).toEqual({});
    expect(
      ProfilePublic.safeParse({ id: uuid(3), handle: 'Ada!', displayName: 'Ada' }).success,
    ).toBe(false);
    expect(
      ProfilePublic.safeParse({
        id: uuid(3),
        handle: 'ada',
        displayName: 'Ada',
        links: { site: 'http://a.b' },
      }).success,
    ).toBe(false);
  });
});

describe('GuestbookEntry and ReportInput', () => {
  it('parse valid input and enforce length limits', () => {
    const entry = {
      id: 1,
      boothId: uuid(1),
      authorId: uuid(2),
      body: 'Love it',
      createdAt: '2026-10-26T10:00:00Z',
    };
    expect(GuestbookEntry.parse(entry)).toEqual(entry);
    expect(GuestbookEntry.safeParse({ ...entry, body: 'x'.repeat(201) }).success).toBe(false);
    expect(
      ReportInput.parse({ targetType: 'booth', targetId: uuid(1), reason: 'spam' }),
    ).toBeTruthy();
    expect(
      ReportInput.safeParse({ targetType: 'booth', targetId: uuid(1), reason: 'meh' }).success,
    ).toBe(false);
    expect(
      ReportInput.safeParse({
        targetType: 'chat',
        targetId: '7',
        reason: 'other',
        note: 'x'.repeat(301),
      }).success,
    ).toBe(false);
  });
});

describe('WorldSnapshot and API schemas', () => {
  const snapshot = {
    version: 3,
    generatedAt: '2026-10-26T10:00:00.000Z',
    districts: [district],
    booths: [boothPublic],
    makers: [{ id: boothPublic.ownerId, handle: 'maker1', displayName: 'Maker One', links: {} }],
  };

  it('parses the /api/world body', () => {
    expect(WorldSnapshot.parse(snapshot)).toEqual(snapshot);
    expect(WorldResponse.parse(snapshot)).toEqual(snapshot);
    expect(WorldSnapshot.safeParse({ ...snapshot, version: -1 }).success).toBe(false);
    expect(WorldRequestQuery.parse({ cb: '123' })).toEqual({});
  });

  it('defaults makers for snapshots without them', () => {
    const { makers: _, ...old } = snapshot;
    expect(WorldSnapshot.parse(old).makers).toEqual([]);
  });

  it('parses health and error bodies', () => {
    expect(HealthResponse.parse({ ok: true, version: 'abc123', db: 'ok' }).db).toBe('ok');
    expect(HealthResponse.safeParse({ ok: true, version: '', db: 'ok' }).success).toBe(false);
    expect(ApiError.parse({ error: { code: 'not_found', message: 'No such booth' } })).toBeTruthy();
    expect(ApiError.safeParse({ error: { code: 'Not Found', message: '' } }).success).toBe(false);
  });
});

describe('env schemas', () => {
  it('only lets VITE_* names into the browser build', () => {
    expect(Object.keys(WebBuildEnv.shape).every((key) => key.startsWith('VITE_'))).toBe(true);
  });

  it('parses a local web build env', () => {
    const env = WebBuildEnv.parse({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_REALTIME_HOST: 'localhost:1999',
      VITE_MEDIA_HOST: 'media.shipfair.xyz',
      VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    });
    expect(env.VITE_SENTRY_DSN).toBeUndefined();
    expect(WebBuildEnv.safeParse({ ...env, VITE_REALTIME_HOST: 'wss://x' }).success).toBe(false);
  });

  it('requires web Worker secrets but not the optional vendors', () => {
    const base = {
      ENVIRONMENT: 'development',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      TURNSTILE_SECRET: 'secret',
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      STATS_INGEST_SECRET: 'stats',
    };
    expect(WebWorkerEnv.parse(base).MODERATION_API_KEY).toBeUndefined();
    expect(WebWorkerEnv.safeParse({ ...base, SUPABASE_SERVICE_ROLE_KEY: '' }).success).toBe(false);
    expect(WebWorkerEnv.safeParse({ ...base, ENVIRONMENT: 'prod' }).success).toBe(false);
  });

  it('requires https for service URLs except on loopback', () => {
    const base = { ENVIRONMENT: 'production', STATS_INGEST_SECRET: 'stats' };
    const jwks = (url: string) =>
      RealtimeEnv.safeParse({ ...base, SUPABASE_JWKS_URL: url }).success;
    expect(jwks('https://x.supabase.co/auth/v1/.well-known/jwks.json')).toBe(true);
    expect(jwks('http://x.supabase.co/auth/v1/.well-known/jwks.json')).toBe(false);
    expect(jwks('http://127.0.0.1:54321/auth/v1/.well-known/jwks.json')).toBe(true);
    expect(jwks('http://localhost:54321/jwks')).toBe(true);
    expect(jwks('http://[::1]:54321/jwks')).toBe(true);
    expect(jwks('http://localhost.evil.com/jwks')).toBe(false);
  });

  it('treats an empty override as unset', () => {
    const env = RealtimeEnv.parse({
      ENVIRONMENT: 'development',
      SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
      STATS_INGEST_SECRET: 'stats',
      AOI_RADIUS_M: '',
    });
    expect(env.AOI_RADIUS_M).toBeUndefined();
  });

  it('coerces realtime limit overrides from strings', () => {
    const env = RealtimeEnv.parse({
      ENVIRONMENT: 'staging',
      SUPABASE_JWKS_URL: 'https://x.supabase.co/auth/v1/.well-known/jwks.json',
      STATS_INGEST_SECRET: 'stats',
      MAX_PLAYERS_PER_SHARD: '120',
    });
    expect(env.MAX_PLAYERS_PER_SHARD).toBe(120);
    expect(env.AOI_RADIUS_M).toBeUndefined();
  });
});
