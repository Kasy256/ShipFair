import { describe, expect, it } from 'vitest';
import { boothSlugBase, filterProfanity, normaliseText, slugify } from './text.ts';
import { isHttpsUrl } from './url.ts';

describe('filterProfanity', () => {
  it.each(['fuck off', 'this is shit', 'you bitch', 'FUCK'])('censors obvious: %s', (input) => {
    const result = filterProfanity(input);
    expect(result.hasProfanity).toBe(true);
    expect(result.text).toContain('★');
  });

  it.each([
    'f*ck',
    'f**k',
    'f***',
    'what the f***',
    'sh**',
    'you sh** head',
    'b**ch',
    'c**t',
    'sh1t',
    'sh!t',
    'b1tch',
    'fuuuuck',
    'a$$',
  ])('censors obfuscated: %s', (input) => {
    expect(filterProfanity(input).hasProfanity).toBe(true);
  });

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

  it('keeps the censored text the same length as the input', () => {
    for (const input of ['f*ck', 'f**k you', 'what the f***', 'well shit, ok', 'b**ch please']) {
      expect(filterProfanity(input).text).toHaveLength(input.length);
    }
  });

  it('catches words hidden with invisible characters once normalised', () => {
    for (const hidden of ['­', '͏', '᠎', '​', 'ㅤ', 'ﾠ']) {
      const input = `f${hidden}uck`;
      expect(normaliseText(input)).toBe('fuck');
      expect(filterProfanity(normaliseText(input)).hasProfanity).toBe(true);
    }
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

  it('leaves one space where a control character sat between spaces', () => {
    expect(normaliseText('a  b')).toBe('a b');
    expect(normaliseText('ab')).toBe('ab');
  });

  it('applies NFKC so look-alike forms fold to plain text', () => {
    expect(normaliseText('Ｓｈｉｐ ﬁle')).toBe('Ship file');
  });
});

describe('isHttpsUrl', () => {
  it('works without URL.canParse (Safari < 17)', () => {
    const canParse = Object.getOwnPropertyDescriptor(URL, 'canParse');
    Reflect.deleteProperty(URL, 'canParse');
    try {
      expect(isHttpsUrl('https://example.com')).toBe(true);
      expect(isHttpsUrl('not a url')).toBe(false);
    } finally {
      if (canParse) Object.defineProperty(URL, 'canParse', canParse);
    }
  });

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

describe('boothSlugBase', () => {
  it('slugifies the name', () => {
    expect(boothSlugBase('My Cool App!')).toBe('my-cool-app');
  });

  it('pads names that slugify to fewer than 3 characters', () => {
    expect(boothSlugBase('AI')).toBe('ai-booth');
    expect(boothSlugBase('🚀🚀')).toBe('booth');
  });
});
