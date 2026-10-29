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
}
