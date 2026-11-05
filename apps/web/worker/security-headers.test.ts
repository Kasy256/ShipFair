import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { BOOT_SCRIPT_SHA256, contentSecurityPolicy, headersFile } from './security-headers.ts';

const directives = (csp: string) =>
  new Map(
    csp.split('; ').map((d) => {
      const [name = '', ...values] = d.split(' ');
      return [name, values] as const;
    }),
  );

const PROD = {
  isDev: false,
  mediaHost: 'media.shipfair.xyz',
  supabaseUrl: 'https://abc.supabase.co',
  realtimeHost: 'rt.shipfair.xyz',
};

describe('Content-Security-Policy (prompt 15 security pass)', () => {
  const csp = directives(contentSecurityPolicy(PROD));

  it('allows no inline or eval scripts, only the boot script by hash', () => {
    const scripts = csp.get('script-src') ?? [];
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts).toContain(`'${BOOT_SCRIPT_SHA256}'`);
    // WebAssembly (Rapier, Basis) only, not JS eval.
    expect(scripts).toContain("'wasm-unsafe-eval'");
    expect(scripts.filter((s) => s.startsWith('https:'))).toEqual([
      'https://challenges.cloudflare.com',
    ]);
  });

  it('allows Turnstile, Sentry ingest, PostHog and our own hosts, nothing wider', () => {
    expect(csp.get('frame-src')).toEqual(['https://challenges.cloudflare.com']);
    const connect = csp.get('connect-src') ?? [];
    expect(connect).toEqual(
      expect.arrayContaining([
        'https://*.ingest.sentry.io',
        'https://*.ingest.de.sentry.io',
        'https://*.posthog.com',
        'https://abc.supabase.co',
        'wss://rt.shipfair.xyz',
        'https://media.shipfair.xyz',
      ]),
    );
    expect(connect).not.toContain('*');
    expect(connect.some((c) => c.startsWith('ws:') || c.startsWith('http:'))).toBe(false);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('development keeps the inline React Refresh preamble working', () => {
    const dev = directives(contentSecurityPolicy({ isDev: true }));
    // A hash next to 'unsafe-inline' would make browsers ignore 'unsafe-inline'.
    expect(dev.get('script-src')).toContain("'unsafe-inline'");
    expect(dev.get('script-src')?.some((s) => s.startsWith("'sha256-"))).toBe(false);
  });

  it('static assets get the same policy through _headers', () => {
    expect(headersFile(PROD)).toContain(`Content-Security-Policy: ${contentSecurityPolicy(PROD)}`);
  });

  it('Worker responses carry the headers', async () => {
    const res = await exports.default.fetch('https://web.test/api/nope');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
