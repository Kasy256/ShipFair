import { describe, expect, it } from 'vitest';
import { CHAT_BURST, CHAT_INTERVAL_S } from './constants.ts';
import { createBucket } from './rate-limit.ts';

const chatBucket = () => createBucket(CHAT_BURST, 1 / CHAT_INTERVAL_S);

describe('createBucket', () => {
  it('allows a burst up to capacity, then refuses', () => {
    const bucket = chatBucket();
    expect([0, 1, 2, 3].map(() => bucket.take(1000))).toEqual([true, true, true, false]);
  });

  it('refills at the given rate', () => {
    const bucket = chatBucket();
    for (let i = 0; i < CHAT_BURST; i++) bucket.take(0);
    expect(bucket.take(1499)).toBe(false);
    expect(bucket.take(1500)).toBe(true);
    expect(bucket.take(1500)).toBe(false);
    expect(bucket.peek(2250)).toBeCloseTo(0.5, 9);
  });

  it('caps at capacity after a long idle', () => {
    const bucket = chatBucket();
    bucket.take(0);
    expect(bucket.peek(3_600_000)).toBe(CHAT_BURST);
    const results = [0, 1, 2, 3].map(() => bucket.take(3_600_000));
    expect(results).toEqual([true, true, true, false]);
  });

  it('refills nothing when the clock goes backwards', () => {
    const bucket = createBucket(1, 1);
    bucket.take(10_000);
    expect(bucket.take(5_000)).toBe(false);
    expect(bucket.take(10_999)).toBe(false);
    expect(bucket.take(11_000)).toBe(true);
  });

  it('charges a cost and refuses without spending when short', () => {
    const bucket = createBucket(5, 0);
    expect(bucket.take(0, 4)).toBe(true);
    expect(bucket.take(0, 2)).toBe(false);
    expect(bucket.peek(0)).toBe(1);
  });

  it('restores from serialised state', () => {
    const bucket = chatBucket();
    bucket.take(0);
    bucket.take(0);
    const restored = createBucket(
      CHAT_BURST,
      1 / CHAT_INTERVAL_S,
      JSON.parse(JSON.stringify(bucket.state())),
    );
    expect(restored.peek(0)).toBe(1);
    expect(createBucket(2, 1, { tokens: 99, lastMs: null }).peek(0)).toBe(2);
  });

  it('rejects nonsense parameters', () => {
    expect(() => createBucket(0, 1)).toThrow(RangeError);
    expect(() => createBucket(1, -1)).toThrow(RangeError);
    expect(() => createBucket(Number.NaN, 1)).toThrow(RangeError);
  });
});
