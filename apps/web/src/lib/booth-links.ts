import { isHttpsUrl, type ProfileLinks } from '@shipfair/shared';

/** The referral tag on every "Try it" click (TRUST_AND_SAFETY.md, PRODUCT.md success signals). */
export const REF_PARAM = 'ref';
export const REF_VALUE = 'shipfair';

/** The booth's URL with `?ref=shipfair` (kept alongside any query it already has). */
export function tryItUrl(url: string): string | null {
  if (!isHttpsUrl(url)) return null;
  const parsed = new URL(url);
  parsed.searchParams.set(REF_PARAM, REF_VALUE);
  return parsed.toString();
}

export function shareUrl(origin: string, slug: string): string {
  return `${origin}/b/${encodeURIComponent(slug)}`;
}

/** A public media URL, or null without a media host (booths then show no images). */
export function mediaUrl(host: string | null, key: string): string | null {
  return host ? `https://${host}/${key.split('/').map(encodeURIComponent).join('/')}` : null;
}

export interface MakerLink {
  label: string;
  href: string;
}

/** Profile links as https URLs. Handles are validated by the schema; the site must be https. */
export function makerLinks(links: ProfileLinks): MakerLink[] {
  const out: MakerLink[] = [];
  if (links.github) out.push({ label: 'GitHub', href: `https://github.com/${links.github}` });
  if (links.x) out.push({ label: 'X', href: `https://x.com/${links.x}` });
  if (links.reddit)
    out.push({ label: 'Reddit', href: `https://www.reddit.com/user/${links.reddit}` });
  if (links.site && isHttpsUrl(links.site)) out.push({ label: 'Website', href: links.site });
  return out;
}
