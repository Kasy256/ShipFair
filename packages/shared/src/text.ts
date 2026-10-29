import {
  DataSet,
  englishDataset,
  englishRecommendedTransformers,
  parseRawPattern,
  RegExpMatcher,
} from 'obscenity';
import { ALLOWLIST_TERMS, BLOCKLIST_PATTERNS } from './blocklist.ts';

const CENSOR_CHAR = '★';
const SLUG_MAX_CHARS = 40;

// Invisible characters used to dodge filters or spoof names: every format character (\p{Cf}:
// soft hyphen, zero-width, bidi controls, BOM, Mongolian vowel separator…), plus the combining
// grapheme joiner and the Hangul fillers, which render blank but aren't Cf.
const INVISIBLE = /\p{Cf}|\u034F|\u115F|\u1160|\u3164|\uFFA0/gu;
// C0/C1 controls except the whitespace ones (\t \n \v \f \r), which the whitespace pass turns into spaces.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;
const WHITESPACE_RUN = /\s+/g;

/** NFKC, strip invisible and control characters, collapse whitespace, trim. For any user text. */
export function normaliseText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/** Lowercase ASCII `a-z0-9-`, at most 40 chars. May return fewer than 3 chars; schemas check that. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // drop the accents NFKD split off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_CHARS)
    .replace(/-+$/, '');
}

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
