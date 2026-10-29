// Client-side booth search for the map overlay: a small subsequence matcher, so "qled" finds
// "Quantum Ledger" without pulling in a search library. Names count more than taglines.

const NAME_WEIGHT = 2;
const SUBSTRING_BONUS = 100;
const PREFIX_BONUS = 50;
const WORD_START_BONUS = 8;
const CONSECUTIVE_BONUS = 5;
const GAP_PENALTY = 1;

const isWordStart = (text: string, i: number) => i === 0 || !/[a-z0-9]/.test(text[i - 1] ?? '');

/**
 * Scores how well `query` matches `text` (both compared lowercase). 0 means no match: every query
 * character must appear in order. Whole substrings beat scattered letters, and prefixes beat both.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  const at = t.indexOf(q);
  if (at >= 0)
    return (
      SUBSTRING_BONUS +
      (at === 0 ? PREFIX_BONUS : isWordStart(t, at) ? WORD_START_BONUS : 0) +
      q.length
    );
  let score = 0;
  let ti = 0;
  let last = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    score += 1;
    if (found === last + 1) score += CONSECUTIVE_BONUS;
    else if (last >= 0) score -= Math.min(found - last - 1, 10) * GAP_PENALTY;
    if (isWordStart(t, found)) score += WORD_START_BONUS;
    last = found;
    ti = found + 1;
  }
  return Math.max(score, 1);
}

export interface Searchable {
  name: string;
  tagline: string;
}

/** The best `limit` matches by name (weighted) and tagline, best first; ties keep input order. */
export function searchBooths<T extends Searchable>(
  items: readonly T[],
  query: string,
  limit: number,
): T[] {
  if (query.trim().length === 0) return [];
  return items
    .map((item, index) => ({
      item,
      index,
      score: Math.max(fuzzyScore(query, item.name) * NAME_WEIGHT, fuzzyScore(query, item.tagline)),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((r) => r.item);
}
