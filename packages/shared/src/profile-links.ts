import type { ProfileLinks } from './schemas/profile.ts';

export type LinkKind = keyof ProfileLinks;

// People paste whatever they have: `@ada`, `u/ada`, or a full profile URL. These prefixes are
// stripped so only the username is stored (ProfileLinks validates what's left).
const PREFIXES: Record<Exclude<LinkKind, 'site'>, RegExp> = {
  reddit: /^(?:https?:\/\/)?(?:(?:www|old|new)\.)?reddit\.com\/(?:u|user)\/|^\/?u\//i,
  x: /^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/|^@/i,
  github: /^(?:https?:\/\/)?(?:www\.)?github\.com\/|^@/i,
};

/**
 * Turns what the user typed into the stored form: a bare username for Reddit, X and GitHub
 * (trailing slashes and query strings dropped), and an `https://` URL for a website without a
 * scheme. Empty input returns `undefined` (the link is removed). Validation happens afterwards.
 */
export function normaliseLinkInput(kind: LinkKind, raw: string): string | undefined {
  const value = raw.trim();
  if (value === '') return undefined;
  if (kind === 'site') return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  return value.replace(PREFIXES[kind], '').replace(/[/?#].*$/, '');
}

/** Public profile URLs for the links a profile shows. */
export function linkHref(kind: LinkKind, value: string): string {
  switch (kind) {
    case 'reddit':
      return `https://www.reddit.com/user/${encodeURIComponent(value)}`;
    case 'x':
      return `https://x.com/${encodeURIComponent(value)}`;
    case 'github':
      return `https://github.com/${encodeURIComponent(value)}`;
    case 'site':
      return value;
  }
}
