import { describe, expect, it } from 'vitest';
import { CHAT_MUTE_MS, CHAT_STRIKE_WINDOW_MS } from '../limits.ts';
import { addStrike, delink, prepareChat } from './chat.ts';

describe('delink', () => {
  it('drops schemes and breaks the dots of links so nothing is clickable', () => {
    expect(delink('see https://evil.com/x?a=1 now')).toBe('see evil[.]com/x?a=1 now');
    expect(delink('www.shop.example.com')).toBe('www[.]shop[.]example[.]com');
    expect(delink('try shipfair.xyz or my.app')).toBe('try shipfair[.]xyz or my[.]app');
    expect(delink('javascript://alert')).toBe('alert');
  });

  it('leaves ordinary sentences alone', () => {
    expect(delink('Nice booth. Love it... 3.5 stars')).toBe('Nice booth. Love it... 3.5 stars');
  });
});

describe('prepareChat', () => {
  it('normalises, censors and de-links', () => {
    expect(prepareChat('  hi​   there  ')).toEqual({ text: 'hi there', isFiltered: false });
    expect(prepareChat('fuck https://x.com')).toEqual({ text: '★★★★ x[.]com', isFiltered: true });
  });

  it('returns null when nothing printable is left', () => {
    expect(prepareChat(' ​⁠ ')).toBeNull();
  });

  it('keeps the result within 160 characters after de-linking', () => {
    const text = prepareChat(`${'a'.repeat(150)} b.co.uk.io`)?.text ?? '';
    expect(Array.from(text).length).toBeLessThanOrEqual(160);
  });
});

describe('addStrike', () => {
  it('mutes on the third strike within 5 minutes and starts a fresh count', () => {
    const one = addStrike([], 0);
    const two = addStrike(one.strikes, 1000);
    expect(two).toEqual({ strikes: [0, 1000], mutedUntil: 0 });
    expect(addStrike(two.strikes, 2000)).toEqual({ strikes: [], mutedUntil: 2000 + CHAT_MUTE_MS });
  });

  it('forgets strikes older than the window', () => {
    const old = addStrike(addStrike([], 0).strikes, 1000).strikes;
    expect(addStrike(old, CHAT_STRIKE_WINDOW_MS + 500)).toEqual({
      strikes: [1000, CHAT_STRIKE_WINDOW_MS + 500],
      mutedUntil: 0,
    });
  });
});
