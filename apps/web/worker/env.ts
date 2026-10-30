/** RPC surface of the realtime Worker's `RealtimeRpc` entrypoint, as seen from web. */
export interface RealtimeRpc {
  ping(): Promise<string>;
}

export interface Env {
  ASSETS: Fetcher;
  REALTIME: Fetcher & RealtimeRpc;
  /** World cache version (and, later, the feature-flag cache). */
  KV: KVNamespace;
  ENVIRONMENT: 'development' | 'staging' | 'production';
  /** Validated where used (`WebWorkerEnv`), so a missing value is a clear 503, not a crash. */
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** Account deletion, submissions, revisions. A secret: .dev.vars locally, wrangler secret elsewhere. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Booth media. Uploads land under `pending/` (private); approval copies them out (prompt 09). */
  MEDIA: R2Bucket;
  /** Bucket name for presigned S3 URLs (the binding's bucket). */
  R2_BUCKET?: string;
  /** S3 API credentials for presigning. Without them, development uploads through the Worker. */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** Text moderation vendor key; none means the pre-screen records `text_unchecked`. */
  MODERATION_API_KEY?: string;
  SAFE_BROWSING_KEY?: string;
  /** Accounts younger than this can't submit (TRUST_AND_SAFETY.md). A string var; default 60. */
  MIN_ACCOUNT_AGE_MINUTES?: string;
}
