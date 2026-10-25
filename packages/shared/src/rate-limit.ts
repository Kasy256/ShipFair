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
 * A clock that goes backwards refills nothing rather than throwing.
 */
export function createBucket(
  capacity: number,
  refillPerSec: number,
  initial?: BucketState,
): TokenBucket {
  if (!(capacity > 0) || !(refillPerSec >= 0)) {
    throw new RangeError('createBucket needs capacity > 0 and refillPerSec >= 0');
  }
  let tokens = initial ? Math.min(initial.tokens, capacity) : capacity;
  let lastMs = initial ? initial.lastMs : null;

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
      refill(nowMs);
      if (tokens < cost) return false;
      tokens -= cost;
      return true;
    },
    peek(nowMs) {
      refill(nowMs);
      return tokens;
    },
    state: () => ({ tokens, lastMs }),
  };
}
