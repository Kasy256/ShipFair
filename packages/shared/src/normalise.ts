// Plain text helpers, kept apart from the profanity filter in text.ts: that one loads obscenity
// (~10 kB gzipped), and normalising or slugifying shouldn't (prompt 14).

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

const SLUG_MIN_CHARS = 3;
const SLUG_FALLBACK = 'booth';

/**
 * The slug a booth name asks for: `slugify(name)`, padded to the 3-character minimum ("AI" →
 * `ai-booth`). The database appends `-2`, `-3`… when another booth has it (prompt 08).
 */
export function boothSlugBase(name: string): string {
  const slug = slugify(name);
  if (slug.length >= SLUG_MIN_CHARS) return slug;
  return slug ? `${slug}-${SLUG_FALLBACK}` : SLUG_FALLBACK;
}
