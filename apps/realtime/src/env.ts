/** RPC surface of the web Worker's `WebRpc` entrypoint, as seen from realtime. */
export interface WebRpc {
  ping(): Promise<string>;
}

export interface Env {
  Coordinator: DurableObjectNamespace;
  WorldShard: DurableObjectNamespace;
  WEB: Fetcher & WebRpc;
  ENVIRONMENT: 'development' | 'staging' | 'production';
}
