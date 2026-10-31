import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { JWKS_CACHE_MS } from './limits.ts';

// Supabase access tokens (ARCHITECTURE.md §7 "Identity in realtime"). Verified against the
// project's JWKS (asymmetric signing keys), which jose caches for JWKS_CACHE_MS per isolate and
// refetches early when a token names an unknown key id.

const JWKS_SUFFIX = '/.well-known/jwks.json';
const AUDIENCE = 'authenticated';
const ALGORITHMS = ['ES256', 'RS256', 'EdDSA'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type TokenCheck =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly reason: 'expired' | 'invalid' };

let keys: { url: string; get: JWTVerifyGetKey } | null = null;

function keySet(jwksUrl: string): JWTVerifyGetKey {
  if (keys?.url !== jwksUrl) {
    keys = {
      url: jwksUrl,
      get: createRemoteJWKSet(new URL(jwksUrl), { cacheMaxAge: JWKS_CACHE_MS }),
    };
  }
  return keys.get;
}

/** Supabase's issuer is the Auth URL, which is where its JWKS lives minus the well-known path. */
export const issuerFor = (jwksUrl: string): string =>
  jwksUrl.endsWith(JWKS_SUFFIX) ? jwksUrl.slice(0, -JWKS_SUFFIX.length) : jwksUrl;

export async function verifyAccessToken(token: string, jwksUrl: string): Promise<TokenCheck> {
  try {
    const { payload } = await jwtVerify(token, keySet(jwksUrl), {
      audience: AUDIENCE,
      issuer: issuerFor(jwksUrl),
      algorithms: ALGORITHMS,
    });
    const sub = payload.sub;
    if (typeof sub !== 'string' || !UUID.test(sub)) return { ok: false, reason: 'invalid' };
    return { ok: true, userId: sub };
  } catch (error) {
    if (error instanceof errors.JWTExpired) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}
