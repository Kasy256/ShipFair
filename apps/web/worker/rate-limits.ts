import { createBucket, type TokenBucket } from '@shipfair/shared';
import { AppError } from './errors.ts';

// Per-user token buckets for the submission routes. They live in this isolate only, so they slow
// a script down rather than enforce an exact global rate; Turnstile on submit and the DB limits
// (1 pending, 3 booths) are the real fences. A global limit needs KV or a Durable Object.

export interface RouteLimit {
  readonly capacity: number;
  readonly refillPerSec: number;
}

export const ROUTE_LIMITS = {
  // 6 images per booth, a few retries and re-crops.
  sign: { capacity: 30, refillPerSec: 0.5 },
  checkUrl: { capacity: 10, refillPerSec: 0.2 },
  submit: { capacity: 5, refillPerSec: 0.05 },
} as const satisfies Record<string, RouteLimit>;

const MAX_BUCKETS = 10_000;
const buckets = new Map<string, TokenBucket>();

/** Spends one token for `user` on `route`, or throws `rate_limited` (429). */
export function rateLimit(route: keyof typeof ROUTE_LIMITS, user: string, nowMs = Date.now()) {
  const key = `${route}:${user}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear(); // bounded memory; resets are harmless
    const { capacity, refillPerSec } = ROUTE_LIMITS[route];
    bucket = createBucket(capacity, refillPerSec);
    buckets.set(key, bucket);
  }
  if (!bucket.take(nowMs)) {
    throw new AppError('rate_limited', 429, 'Too many requests; wait a moment and try again');
  }
}

/** Tests only: forget every bucket. */
export function resetRateLimits(): void {
  buckets.clear();
}
