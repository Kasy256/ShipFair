import { describe, expect, it } from 'vitest';
import { makerLinks, mediaUrl, shareUrl, tryItUrl } from './booth-links.ts';

describe('tryItUrl', () => {
  it('adds ref=shipfair and keeps the existing query', () => {
    expect(tryItUrl('https://example.com/app')).toBe('https://example.com/app?ref=shipfair');
    expect(tryItUrl('https://example.com/?plan=pro#top')).toBe(
      'https://example.com/?plan=pro&ref=shipfair#top',
    );
  });

  it('replaces a ref the maker already set', () => {
    expect(tryItUrl('https://example.com/?ref=producthunt')).toBe(
      'https://example.com/?ref=shipfair',
    );
  });

  it('refuses anything but https', () => {
    expect(tryItUrl('http://example.com')).toBeNull();
    expect(tryItUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('links', () => {
  it('builds share and media URLs', () => {
    expect(shareUrl('https://shipfair.xyz', 'example-pretend-pilot')).toBe(
      'https://shipfair.xyz/b/example-pretend-pilot',
    );
    expect(mediaUrl('media.shipfair.xyz', 'u/abc/shot 1.webp')).toBe(
      'https://media.shipfair.xyz/u/abc/shot%201.webp',
    );
    expect(mediaUrl(null, 'u/abc/1.webp')).toBeNull();
  });

  it('turns profile handles into https links', () => {
    expect(
      makerLinks({ github: 'maker1', x: 'maker_1', reddit: 'maker-1', site: 'https://maker.dev' }),
    ).toEqual([
      { label: 'GitHub', href: 'https://github.com/maker1' },
      { label: 'X', href: 'https://x.com/maker_1' },
      { label: 'Reddit', href: 'https://www.reddit.com/user/maker-1' },
      { label: 'Website', href: 'https://maker.dev' },
    ]);
    expect(makerLinks({})).toEqual([]);
  });
});
