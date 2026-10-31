import { describe, expect, it } from 'vitest';
import { ageText, queueKeyAction, reviewUrl } from './admin-format.ts';

const key = (k: string, extra: Partial<Parameters<typeof queueKeyAction>[0]> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: { tagName: 'BODY' },
  ...extra,
});

describe('queueKeyAction', () => {
  it('maps A, R, J, K and O in either case', () => {
    expect(['a', 'r', 'j', 'k', 'o', 'A', 'J'].map((k) => queueKeyAction(key(k)))).toEqual([
      'approve',
      'reject',
      'next',
      'prev',
      'open',
      'approve',
      'next',
    ]);
    expect(queueKeyAction(key('x'))).toBeNull();
  });

  it('leaves typing and browser shortcuts alone', () => {
    expect(queueKeyAction(key('a', { target: { tagName: 'INPUT' } }))).toBeNull();
    expect(queueKeyAction(key('a', { target: { tagName: 'TEXTAREA' } }))).toBeNull();
    expect(queueKeyAction(key('a', { target: { isContentEditable: true } }))).toBeNull();
    expect(queueKeyAction(key('r', { ctrlKey: true }))).toBeNull();
    expect(queueKeyAction(key('k', { metaKey: true }))).toBeNull();
  });
});

describe('ageText', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  it('picks minutes, hours or days', () => {
    expect(ageText('2026-10-30T11:59:30Z', now)).toBe('0 minutes');
    expect(ageText('2026-10-30T11:59:00Z', now)).toBe('1 minute');
    expect(ageText('2026-10-30T07:00:00Z', now)).toBe('5 hours');
    expect(ageText('2026-10-27T12:00:00Z', now)).toBe('3 days');
    expect(ageText('2026-10-30T13:00:00Z', now)).toBe('0 minutes');
  });
});

describe('reviewUrl', () => {
  it('prefers where the link ended up', () => {
    expect(reviewUrl({ url: 'https://a.test/', finalUrl: 'https://b.test/x' })).toBe(
      'https://b.test/x',
    );
    expect(reviewUrl({ url: 'https://a.test/', finalUrl: null })).toBe('https://a.test/');
  });
});
