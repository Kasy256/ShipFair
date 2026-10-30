import { describe, expect, it } from 'vitest';
import { NAME_CORPUS } from '../scripts/blocklist-corpus.ts';
import {
  blocklistTerms,
  hasProfanitySql,
  LEET_FROM,
  LEET_TO,
  sqlEquivalentMatch,
} from '../scripts/blocklist-sql.ts';
import { filterProfanity } from '../src/text.ts';

describe('has_profanity SQL generator', () => {
  const terms = blocklistTerms();

  it('agrees with filterProfanity on the whole corpus', () => {
    const disagreements = NAME_CORPUS.filter(
      (input) => sqlEquivalentMatch(input, terms) !== filterProfanity(input).hasProfanity,
    );
    expect(disagreements).toEqual([]);
    // The corpus has both sides, so agreement means something.
    const flagged = NAME_CORPUS.filter((input) => filterProfanity(input).hasProfanity);
    expect(flagged.length).toBeGreaterThan(200);
    expect(NAME_CORPUS.length - flagged.length).toBeGreaterThan(30);
  });

  it('includes our own masked patterns', () => {
    expect(sqlEquivalentMatch('f***', terms)).toBe(true);
    expect(sqlEquivalentMatch('b**ch', terms)).toBe(true);
  });

  it('maps leet characters one to one for translate()', () => {
    expect(LEET_FROM.length).toBe(LEET_TO.length);
  });

  it('writes one stable function', () => {
    const sql = hasProfanitySql(terms);
    expect(sql).toBe(hasProfanitySql(terms));
    expect(sql).toContain('create or replace function public.has_profanity(input text)');
    expect(sql).toContain("set search_path = ''");
  });
});
