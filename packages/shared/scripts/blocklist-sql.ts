// Mirrors the client's profanity filter (src/text.ts) as one Postgres function, `has_profanity`,
// so the database can refuse names (and, from prompt 12, guestbook entries) that skip the client.
// Pure: the CLI in sync-blocklist.ts writes the result into a migration.
//
// The SQL follows obscenity's English matcher step by step: whitelisted terms are blanked out of
// the lowercased text, then leet-speak is resolved, characters are lowercased and runs collapsed
// (b, e, o, l, s, g keep two), and the patterns are matched with obscenity's word boundaries
// (letters, digits and `_` are word characters). Unicode confusables are approximated with
// NFKC. One known gap: blanking an allowed word also hides a match that only overlaps it
// ("xanaly"), so the database is slightly more lenient. The client filter stays the main check.
// A JS copy of the same steps (`sqlEquivalentMatch`) is tested against the real matcher.
import {
  DataSet,
  englishDataset,
  type ParsedPattern,
  parseRawPattern,
  SyntaxKind,
} from 'obscenity';
import { ALLOWLIST_TERMS, BLOCKLIST_PATTERNS } from '../src/blocklist.ts';

/** obscenity's resolveLeetSpeak dictionary: each character on the right becomes the letter. */
const LEET: readonly (readonly [string, string])[] = [
  ['a', '@4'],
  ['c', '('],
  ['e', '3'],
  ['g', '6'],
  ['i', '1|!'],
  ['l', '/'],
  ['o', '0'],
  ['s', '$5'],
  ['t', '7'],
  ['z', '2'],
];
/** Characters whose runs collapse to two instead of one (obscenity's custom thresholds). */
const KEEP_TWO = 'beolsg';
/** Word characters for obscenity's `|` boundaries (its compiled regexes use `\b`, so `_` counts). */
const WORD = '[a-z0-9_]';

export const LEET_FROM = LEET.map(([, from]) => from).join('');
export const LEET_TO = LEET.map(([to, from]) => to.repeat(from.length)).join('');

interface Terms {
  patterns: readonly ParsedPattern[];
  whitelist: readonly string[];
}

/** The dataset plus our own patterns and allowlist (src/blocklist.ts). */
export function blocklistTerms(): Terms {
  const custom = new DataSet<{ originalWord?: string }>().addAll(englishDataset);
  for (const raw of BLOCKLIST_PATTERNS) {
    custom.addPhrase((phrase) => {
      phrase.addPattern(parseRawPattern(raw));
      for (const term of ALLOWLIST_TERMS) phrase.addWhitelistedTerm(term);
      return phrase;
    });
  }
  const built = custom.build();
  const whitelist = [...new Set((built.whitelistedTerms ?? []).map((t) => t.toLowerCase()))];
  // Longest first, so a longer allowed word is blanked before a shorter one inside it.
  whitelist.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return { patterns: built.blacklistedTerms.map((t) => t.pattern), whitelist };
}

const escapeChar = (c: string) => (/[a-z0-9 ]/.test(c) ? c : `\\${c}`);

type PatternNode = ParsedPattern['nodes'][number];

function nodeSource(node: PatternNode): string {
  switch (node.kind) {
    case SyntaxKind.Literal:
      return String.fromCharCode(...node.chars)
        .split('')
        .map(escapeChar)
        .join('');
    case SyntaxKind.Wildcard:
      return '.';
    case SyntaxKind.Optional:
      return `(?:${nodeSource(node.childNode)})?`;
    default:
      // Boundary assertions only appear as the pattern's start/end flags after parsing.
      throw new Error(`unsupported pattern node ${JSON.stringify(node)}`);
  }
}

/** One pattern as a regex that works in both JS and Postgres AREs. */
export function patternSource(pattern: ParsedPattern): string {
  const body = pattern.nodes.map(nodeSource).join('');
  const start = pattern.requireWordBoundaryAtStart ? `(?<!${WORD})` : '';
  const end = pattern.requireWordBoundaryAtEnd ? `(?!${WORD})` : '';
  return `${start}(?:${body})${end}`;
}

/** Every pattern, alternated. */
export function blocklistRegex(terms: Terms = blocklistTerms()): string {
  return terms.patterns.map(patternSource).join('|');
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The SQL steps, in JS, for tests: true when `has_profanity` would be true. */
export function sqlEquivalentMatch(input: string, terms: Terms = blocklistTerms()): boolean {
  let text = input.normalize('NFKC').toLowerCase();
  for (const term of terms.whitelist) text = text.replace(new RegExp(escapeRegex(term), 'g'), ' ');
  text = [...text]
    .map((c) => {
      const i = LEET_FROM.indexOf(c);
      return i >= 0 ? (LEET_TO[i] ?? c) : c;
    })
    .join('');
  text = text
    .replace(new RegExp(`([^${KEEP_TWO}])\\1+`, 'g'), '$1')
    .replace(new RegExp(`([${KEEP_TWO}])\\1{2,}`, 'g'), '$1$1');
  return new RegExp(blocklistRegex(terms)).test(text);
}

const sqlString = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** `create or replace function public.has_profanity(text)` for a migration. */
export function hasProfanitySql(terms: Terms = blocklistTerms()): string {
  const whitelist = terms.whitelist.length
    ? `array[${terms.whitelist.map(sqlString).join(', ')}]::text[]`
    : `'{}'::text[]`;
  return `-- Generated by \`pnpm db:sync-blocklist\` from packages/shared/src/blocklist.ts and obscenity's
-- English dataset. Do not edit; change the list and generate a new migration instead.
create or replace function public.has_profanity(input text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $fn$
declare
  allowed constant text[] := ${whitelist};
  pattern constant text := ${sqlString(blocklistRegex(terms))};
  text_ text := lower(normalize(coalesce(input, ''), NFKC));
  term text;
begin
  foreach term in array allowed loop
    text_ := replace(text_, term, ' ');
  end loop;
  text_ := translate(text_, ${sqlString(LEET_FROM)}, ${sqlString(LEET_TO)});
  text_ := regexp_replace(text_, '([^${KEEP_TWO}])\\1+', '\\1', 'g');
  text_ := regexp_replace(text_, '([${KEEP_TWO}])\\1{2,}', '\\1\\1', 'g');
  return text_ ~ pattern;
end;
$fn$;
`;
}
