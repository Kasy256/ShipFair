import { describe, expect, it } from 'vitest';
import { entryIndexAt, timeAgo } from './just-launched.ts';

// The wall's canvas needs a DOM; its pure parts are tested here, the drawing in e2e.

describe('timeAgo', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  it('reads like a person would say it', () => {
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 49 * 3_600_000, now)).toBe('2 d ago');
    // A clock a little behind the server's never says "-1 min".
    expect(timeAgo(now + 30_000, now)).toBe('just now');
  });
});

describe('entryIndexAt', () => {
  it('maps the two columns of six rows, newest top-left', () => {
    expect(entryIndexAt(0.1, 0.75)).toBe(0);
    expect(entryIndexAt(0.1, 0.05)).toBe(5);
    expect(entryIndexAt(0.6, 0.75)).toBe(6);
    expect(entryIndexAt(0.9, 0.05)).toBe(11);
  });

  it('misses the header and points off the screen', () => {
    expect(entryIndexAt(0.5, 0.95)).toBe(-1);
    expect(entryIndexAt(-0.1, 0.5)).toBe(-1);
    expect(entryIndexAt(1.1, 0.5)).toBe(-1);
  });
});
