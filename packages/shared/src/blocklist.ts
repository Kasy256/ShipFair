// Our additions on top of obscenity's English dataset. Prompt 12 mirrors this list into SQL
// (tools/sync-blocklist.ts) for the guestbook trigger, so keep entries as plain strings.
//
// Pattern syntax is obscenity's: `?` matches any one character, `[x]` makes x optional and `|` at
// either end anchors to a word boundary. Matching runs after leet-speak and confusable folding,
// so `sh1t` and `ſhit` are handled by the dataset already. These cover masked spellings it misses.
export const BLOCKLIST_PATTERNS: readonly string[] = [
  'f**k',
  'f***',
  'f*k',
  'sh**',
  'b**ch',
  'c**t',
  '|fuk|',
  '|fukk|',
];

// Words that contain a blocked pattern but are fine. The dataset's own whitelist already covers
// common cases (Scunthorpe, assess, class).
export const ALLOWLIST_TERMS: readonly string[] = [];
