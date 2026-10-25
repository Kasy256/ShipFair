import { describe, expect, it } from 'vitest';
import { filterProfanity, isHttpsUrl, normaliseText, slugify } from './text.ts';

describe('filterProfanity', () => {
  it.each(['fuck off', 'this is shit', 'you bitch', 'FUCK'])('censors obvious: %s', (input) => {
    const result = filterProfanity(input);
    expect(result.hasProfanity).toBe(true);
    expect(result.text).toContain('★');
  });

  it.each(['f*ck', 'f**k', 'sh1t', 'sh!t', 'b1tch', 'fuuuuck', 'a$$'])(
    'censors obfuscated: %s',
    (input) => {
      expect(filterProfanity(input).hasProfanity).toBe(true);
    },
  );

  it.each([
    'Scunthorpe',
    'class',
    'assess',
    'assassin',
    'cocktail',
    'analysis',
    'shitake',
    'cumulative',
  ])('leaves false positives alone: %s', (input) => {
    expect(filterProfanity(input)).toEqual({ text: input, hasProfanity: false, matchCount: 0 });
  });

  it('replaces only the matched span, with one ★ per character', () => {
    expect(filterProfanity('well shit, ok')).toMatchObject({
      text: 'well ★★★★, ok',
      matchCount: 1,
    });
  });

  it('counts every match', () => {
    expect(filterProfanity('shit fuck shit').matchCount).toBe(3);
  });
});

describe('normaliseText', () => {
  it('trims and collapses whitespace, including newlines and tabs', () => {
    expect(normaliseText('  hello \n\t world  ')).toBe('hello world');
  });

  it('strips zero-width, bidi and control characters', () => {
    expect(normaliseText('ad​min‮\u0007')).toBe('admin');
    expect(normaliseText('﻿hi⁦')).toBe('hi');
  });

  it('applies NFKC so look-alike forms fold to plain text', () => {
    expect(normaliseText('Ｓｈｉｐ ﬁle')).toBe('Ship file');
  });
});

describe('isHttpsUrl', () => {
  it.each(['https://example.com', 'https://a.b/c?d=e#f', 'https://xn--bcher-kva.example/'])(
    'accepts %s',
    (url) => {
      expect(isHttpsUrl(url)).toBe(true);
    },
  );

  it.each([
    'http://example.com',
    'javascript:alert(1)',
    'ftp://example.com',
    'example.com',
    '//example.com',
    'https://user:pass@example.com',
    'https://',
    '',
  ])('rejects %s', (url) => {
    expect(isHttpsUrl(url)).toBe(false);
  });
});

describe('slugify', () => {
  it.each([
    ['My Cool App', 'my-cool-app'],
    ['  Café Déjà Vu!! ', 'cafe-deja-vu'],
    ['AI---Agent__Tool', 'ai-agent-tool'],
    ['🚀 Launch', 'launch'],
    [`${'a'.repeat(39)} b`, 'a'.repeat(39)],
    ['!!!', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('never exceeds 40 characters', () => {
    expect(slugify('word '.repeat(30)).length).toBeLessThanOrEqual(40);
  });
});
