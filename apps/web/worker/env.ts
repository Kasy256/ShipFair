/** RPC surface of the realtime Worker's `RealtimeRpc` entrypoint, as seen from web. */
export interface RealtimeRpc {
  ping(): Promise<string>;
}

export interface Env {
  ASSETS: Fetcher;
  REALTIME: Fetcher & RealtimeRpc;
  ENVIRONMENT: 'development' | 'staging' | 'production';
}
