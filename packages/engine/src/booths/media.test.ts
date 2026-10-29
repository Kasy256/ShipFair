import { describe, expect, it } from 'vitest';
import { initials, mediaUrl } from './media.ts';

describe('mediaUrl', () => {
  it('builds https URLs on the media host only', () => {
    expect(mediaUrl('media.shipfair.xyz', 'u/abc/logo.png')).toBe(
      'https://media.shipfair.xyz/u/abc/logo.png',
    );
  });

  it('uses http for a loopback dev host', () => {
    expect(mediaUrl('localhost:8787', 'a.png')).toBe('http://localhost:8787/a.png');
  });

  it('encodes each path segment', () => {
    expect(mediaUrl('m.test', 'u/a b/#x.png')).toBe('https://m.test/u/a%20b/%23x.png');
  });
});

describe('initials', () => {
  it('takes the first letters of two words, or two letters of one', () => {
    expect(initials('Pixel Ledger AI')).toBe('PL');
    expect(initials('otter')).toBe('OT');
    expect(initials('  rapid   kite ')).toBe('RK');
  });
});
