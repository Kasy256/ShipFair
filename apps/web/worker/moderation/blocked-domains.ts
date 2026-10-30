// Hosts a booth link may not point at (prompt 08 pre-screen). URL shorteners hide the real
// destination from reviewers and visitors; the rest are common throwaway or abuse hosts. A host
// matches itself and its subdomains. Grow this from moderation experience.
export const BLOCKED_DOMAINS: readonly string[] = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'cutt.ly',
  'rebrand.ly',
  'shorturl.at',
  'grabify.link',
  'iplogger.org',
];

export function isBlockedHost(url: string, blocked: readonly string[] = BLOCKED_DOMAINS): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return true;
  }
  return blocked.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
