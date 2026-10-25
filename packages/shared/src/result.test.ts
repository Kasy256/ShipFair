import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, mapResult, ok, type Result, unwrapOr } from './result.ts';

describe('Result', () => {
  const good: Result<number, string> = ok(2);
  const bad: Result<number, string> = err('nope');

  it('narrows with isOk and isErr', () => {
    expect(isOk(good) && good.value).toBe(2);
    expect(isErr(bad) && bad.error).toBe('nope');
    expect(isOk(bad)).toBe(false);
  });

  it('maps only successes and unwraps with a fallback', () => {
    expect(mapResult(good, (n) => n * 10)).toEqual(ok(20));
    expect(mapResult(bad, (n) => n * 10)).toBe(bad);
    expect(unwrapOr(good, 0)).toBe(2);
    expect(unwrapOr(bad, 0)).toBe(0);
  });
});
