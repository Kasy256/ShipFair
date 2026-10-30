// Our additions on top of obscenity's English dataset. `pnpm db:sync-blocklist` mirrors them into SQL
// (`public.has_profanity`, packages/shared/scripts) for the name checks, so keep entries as plain strings.
//
// Pattern syntax is obscenity's: `?` matches any one character, `[x]` makes x optional and `|` at
// either end anchors to a word boundary (but a trailing `|` after `*` never matches, so masked
// patterns only anchor their start). Matching runs after the recommended transformers, which fold
// leet-speak and confusables (`sh1t`, `ſhit` are handled by the dataset) and collapse repeated
// characters (`f**k` → `f*k`, `sh**` → `sh*`). Write patterns in that collapsed form, or they can
// never match. These cover masked spellings the dataset misses.
export const BLOCKLIST_PATTERNS: readonly string[] = [
  '|f*', // f*, f**k, f***
  '|sh*', // sh**
  'b*ch', // b**ch
  '|c*t|', // c**t
];

// Words that contain a blocked pattern but are fine. The dataset's own whitelist already covers
// common cases (Scunthorpe, assess, class).
export const ALLOWLIST_TERMS: readonly string[] = [];
