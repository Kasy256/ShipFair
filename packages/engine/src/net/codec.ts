type Codec = typeof import('@shipfair/shared/codec');

let codec: Codec | undefined;
let pending: Promise<Codec> | undefined;

/**
 * The msgpack codec (msgpackr, ~10 kB gzipped) is its own chunk: it downloads while the client
 * joins its first shard, not with the engine, so it stays out of the first load (prompt 14).
 */
export function loadCodec(): Promise<Codec> {
  pending ??= import('@shipfair/shared/codec').then(
    (loaded) => {
      codec = loaded;
      return loaded;
    },
    (error: unknown) => {
      pending = undefined; // the next join retries the download
      throw error;
    },
  );
  return pending;
}

/** The codec once `loadCodec()` has resolved. A socket only opens after that. */
export function loadedCodec(): Codec | undefined {
  return codec;
}
