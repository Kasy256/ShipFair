// Google Safe Browsing Lookup API v4 (optional; SAFE_BROWSING_KEY). True when Google lists the
// URL as malware, social engineering or unwanted software. Throws on transport errors, so the
// pre-screen records the check as not run instead of calling the URL safe.

const ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

export async function isListedUnsafe(
  apiKey: string,
  urls: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const res = await fetcher(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client: { clientId: 'shipfair', clientVersion: '1' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: urls.map((url) => ({ url })),
      },
    }),
  });
  if (!res.ok) throw new Error(`Safe Browsing answered ${res.status}`);
  const body = (await res.json()) as { matches?: unknown[] };
  return Array.isArray(body.matches) && body.matches.length > 0;
}
