// Kept apart from text.ts: the schemas need this, and text.ts imports obscenity, which is
// CommonJS and can't be tree-shaken. Browser bundles that only validate never load the filter.

/** True for absolute `https:` URLs with a host and no embedded credentials. */
export function isHttpsUrl(input: string): boolean {
  let url: URL;
  try {
    // Not URL.canParse: it's missing before Safari 17 / Chrome 120.
    url = new URL(input);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
  );
}
