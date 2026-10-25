/** Plain data, so a bucket survives Durable Object hibernation via `serializeAttachment`. */
export interface BucketState {
  tokens: number;
  /** null until the first `take`/`peek`. */
  lastMs: number | null;
}

export interface TokenBucket {
  /** Spends `cost` tokens if available. Returns false (and spends nothing) otherwise. */
  take(nowMs: number, cost?: number): boolean;
  /** Tokens available at `nowMs`, without spending. */
  peek(nowMs: number): number;
  state(): BucketState;
}

const MS_PER_S = 1000;

/**
 * Token bucket, full at creation. Time is passed in, so it is pure and testable.
 * A clock that goes backwards refills nothing rather than throwing. Non-finite times or costs are
 * refused, so a NaN can never poison the state and switch the limit off.
 */
export function createBucket(
  capacity: number,
  refillPerSec: number,
  initial?: BucketState,
): TokenBucket {
  if (
    !(
      capacity > 0 &&
      Number.isFinite(capacity) &&
      refillPerSec >= 0 &&
      Number.isFinite(refillPerSec)
    )
  ) {
    throw new RangeError('createBucket needs finite capacity > 0 and refillPerSec >= 0');
  }
  // Restored state comes from storage; anything malformed falls back to a fresh, full bucket.
  const isValidState =
    initial !== undefined &&
    Number.isFinite(initial.tokens) &&
    (initial.lastMs === null || Number.isFinite(initial.lastMs));
  let tokens = isValidState ? Math.min(Math.max(initial.tokens, 0), capacity) : capacity;
  let lastMs = isValidState ? initial.lastMs : null;

  const refill = (nowMs: number): void => {
    if (lastMs === null) {
      lastMs = nowMs;
      return;
    }
    const elapsedMs = nowMs - lastMs;
    if (elapsedMs <= 0) return;
    tokens = Math.min(capacity, tokens + (elapsedMs * refillPerSec) / MS_PER_S);
    lastMs = nowMs;
  };

  return {
    take(nowMs, cost = 1) {
      if (!Number.isFinite(nowMs) || !Number.isFinite(cost) || cost < 0) return false;
      refill(nowMs);
      if (tokens < cost) return false;
      tokens -= cost;
      return true;
    },
    peek(nowMs) {
      if (Number.isFinite(nowMs)) refill(nowMs);
      return tokens;
    },
    state: () => ({ tokens, lastMs }),
  };
}
