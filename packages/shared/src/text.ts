import {
  DataSet,
  englishDataset,
  englishRecommendedTransformers,
  parseRawPattern,
  RegExpMatcher,
} from 'obscenity';
import { ALLOWLIST_TERMS, BLOCKLIST_PATTERNS } from './blocklist.ts';

const CENSOR_CHAR = '★';

export interface ProfanityResult {
  /** The input with each matched span replaced by ★ characters. */
  readonly text: string;
  readonly hasProfanity: boolean;
  /** Distinct censored spans (several dataset patterns can match the same word). */
  readonly matchCount: number;
}

let matcher: RegExpMatcher | undefined;

// Built on first use: compiling the dataset costs a few ms and shouldn't run at import time.
function getMatcher(): RegExpMatcher {
  if (matcher) return matcher;
  const custom = new DataSet<{ originalWord?: string }>().addAll(englishDataset);
  for (const raw of BLOCKLIST_PATTERNS) {
    custom.addPhrase((phrase) => {
      phrase.setMetadata({ originalWord: raw }).addPattern(parseRawPattern(raw));
      for (const term of ALLOWLIST_TERMS) phrase.addWhitelistedTerm(term);
      return phrase;
    });
  }
  matcher = new RegExpMatcher({ ...custom.build(), ...englishRecommendedTransformers });
  return matcher;
}

/** Censors profanity and slurs for chat, guestbook entries, handles and display names. */
export function filterProfanity(input: string): ProfanityResult {
  // Several dataset patterns can match the same word, so merge overlapping matches into spans and
  // censor those. obscenity's TextCensor doesn't merge them and can emit too many ★.
  const matches = getMatcher().getAllMatches(input, true); // sorted by start
  let text = '';
  let spans = 0;
  let cursor = 0; // first index not yet copied or censored
  for (const { startIndex, endIndex } of matches) {
    if (endIndex < cursor) continue;
    const start = Math.max(startIndex, cursor);
    if (startIndex >= cursor) spans++;
    text += input.slice(cursor, start) + CENSOR_CHAR.repeat(endIndex - start + 1);
    cursor = endIndex + 1;
  }
  text += input.slice(cursor);
  return { text, hasProfanity: spans > 0, matchCount: spans };
}
