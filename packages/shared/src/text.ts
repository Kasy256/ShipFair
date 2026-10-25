import {
  DataSet,
  englishDataset,
  englishRecommendedTransformers,
  fixedCharCensorStrategy,
  parseRawPattern,
  RegExpMatcher,
  TextCensor,
} from 'obscenity';
import { ALLOWLIST_TERMS, BLOCKLIST_PATTERNS } from './blocklist.ts';

const CENSOR_CHAR = '★';
const SLUG_MAX_CHARS = 40;

// Zero-width characters, bidi controls and the BOM: invisible, and used to dodge filters or spoof names.
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/g;
// C0/C1 control characters. Whitespace controls are folded to spaces before this runs.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE_RUN = /\s+/g;

/** NFKC, strip invisible and control characters, collapse whitespace, trim. For any user text. */
export function normaliseText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(WHITESPACE_RUN, ' ')
    .replace(CONTROL, '')
    .trim();
}

/** True for absolute `https:` URLs with a host and no embedded credentials. */
export function isHttpsUrl(input: string): boolean {
  if (!URL.canParse(input)) return false;
  const url = new URL(input);
  return (
    url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
  );
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

interface Filter {
  readonly matcher: RegExpMatcher;
  readonly censor: TextCensor;
}

let filter: Filter | undefined;

// Built on first use: compiling the dataset costs a few ms and shouldn't run at import time.
function getFilter(): Filter {
  if (filter) return filter;
  const custom = new DataSet<{ originalWord?: string }>().addAll(englishDataset);
  for (const raw of BLOCKLIST_PATTERNS) {
    custom.addPhrase((phrase) => {
      phrase.setMetadata({ originalWord: raw }).addPattern(parseRawPattern(raw));
      for (const term of ALLOWLIST_TERMS) phrase.addWhitelistedTerm(term);
      return phrase;
    });
  }
  filter = {
    matcher: new RegExpMatcher({ ...custom.build(), ...englishRecommendedTransformers }),
    censor: new TextCensor().setStrategy(fixedCharCensorStrategy(CENSOR_CHAR)),
  };
  return filter;
}

/** Censors profanity and slurs for chat, guestbook entries, handles and display names. */
export function filterProfanity(input: string): ProfanityResult {
  const { matcher, censor } = getFilter();
  const matches = matcher.getAllMatches(input, true); // sorted by position
  let spans = 0;
  let spanEnd = -1;
  for (const match of matches) {
    if (match.startIndex > spanEnd) spans++;
    spanEnd = Math.max(spanEnd, match.endIndex);
  }
  return {
    text: spans === 0 ? input : censor.applyTo(input, matches),
    hasProfanity: spans > 0,
    matchCount: spans,
  };
}
