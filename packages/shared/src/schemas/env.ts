import * as z from 'zod';
import { HttpsUrl } from './common.ts';

// Env var contracts (INFRASTRUCTURE.md §4). Bindings (Durable Objects, services, KV, R2) are typed
// by `wrangler types`, not here; these cover string vars and secrets only.

export const Environment = z.enum(['development', 'staging', 'production']);
export type Environment = z.infer<typeof Environment>;

const Secret = z.string().min(1);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// https everywhere. Plain http only to loopback, where local Supabase and wrangler dev run, so a
// production http URL (a JWKS anyone on the path could swap, a service key sent in clear) fails.
const ServiceUrl = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname);
}, 'Use https (http is only allowed for localhost)');
const Host = z
  .string()
  .regex(/^[a-z0-9.-]+(:\d{1,5})?$/i, 'Use a host name, optionally with :port');

/** Public values baked into the SPA at build time. Only `VITE_*` names, by rule. */
export const WebBuildEnv = z.object({
  VITE_SUPABASE_URL: ServiceUrl,
  VITE_SUPABASE_ANON_KEY: Secret,
  VITE_REALTIME_HOST: Host,
  VITE_MEDIA_HOST: Host,
  VITE_TURNSTILE_SITE_KEY: Secret,
  VITE_SENTRY_DSN: HttpsUrl.optional(),
  VITE_POSTHOG_KEY: Secret.optional(),
});
export type WebBuildEnv = z.infer<typeof WebBuildEnv>;

/** Vars and secrets of the web Worker (Hono `/api`). */
export const WebWorkerEnv = z.object({
  ENVIRONMENT: Environment,
  SUPABASE_URL: ServiceUrl,
  /** `/api/world` reads with the anon key so RLS applies. */
  SUPABASE_ANON_KEY: Secret,
  SUPABASE_SERVICE_ROLE_KEY: Secret,
  TURNSTILE_SECRET: Secret,
  R2_ACCOUNT_ID: Secret,
  R2_ACCESS_KEY_ID: Secret,
  R2_SECRET_ACCESS_KEY: Secret,
  STATS_INGEST_SECRET: Secret,
  /** v1 launches with no text moderation vendor (TRUST_AND_SAFETY.md). */
  MODERATION_API_KEY: Secret.optional(),
  SAFE_BROWSING_KEY: Secret.optional(),
});
export type WebWorkerEnv = z.infer<typeof WebWorkerEnv>;

// Unset and empty (`AOI_RADIUS_M=`) both mean "no override".
const OptionalInt = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

/** Vars and secrets of the realtime Worker. Limit overrides exist for load tests only. */
export const RealtimeEnv = z.object({
  ENVIRONMENT: Environment,
  SUPABASE_JWKS_URL: ServiceUrl,
  STATS_INGEST_SECRET: Secret,
  MAX_PLAYERS_PER_SHARD: OptionalInt,
  AOI_RADIUS_M: OptionalInt,
  CHAT_RADIUS_M: OptionalInt,
});
export type RealtimeEnv = z.infer<typeof RealtimeEnv>;
