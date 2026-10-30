import {
  APP_NAME,
  isHttpsUrl,
  URL_CHECK_MAX_REDIRECTS,
  URL_CHECK_TIMEOUT_MS,
} from '@shipfair/shared';

// Fetches a booth URL the way a visitor's browser would: GET, at most 3 redirects followed by
// hand (so each hop is checked), a 5 s budget for the whole chain. Workers can't reach private
// networks, but IP literals and localhost are refused anyway: a booth link should be a site.

export interface UrlCheck {
  /** Final answer was < 400 and every hop stayed on https. */
  readonly isReachable: boolean;
  /** False when a redirect left https (or the chain broke before an answer). */
  readonly isHttps: boolean;
  /** Where the chain ended, when it ended on https. */
  readonly finalUrl: string | null;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const IP_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;
const LOCAL_HOST = /(^|\.)(localhost|local|internal)$/i;

function isPublicHttps(url: string): boolean {
  if (!isHttpsUrl(url)) return false;
  const host = new URL(url).hostname;
  return !IP_HOST.test(host) && !LOCAL_HOST.test(host);
}

const failed = (isHttps: boolean): UrlCheck => ({ isReachable: false, isHttps, finalUrl: null });

export async function checkUrl(url: string, fetcher: Fetcher = fetch): Promise<UrlCheck> {
  if (!isPublicHttps(url)) return failed(false);
  const signal = AbortSignal.timeout(URL_CHECK_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; hop <= URL_CHECK_MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetcher(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
          'user-agent': `${APP_NAME}Bot/1.0 (+booth link check)`,
          accept: 'text/html,*/*',
        },
      });
    } catch {
      return failed(true);
    }
    await res.body?.cancel();
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current).toString();
      if (!isPublicHttps(next)) return failed(false);
      current = next;
      continue;
    }
    const isOk = res.status < 400;
    return { isReachable: isOk, isHttps: true, finalUrl: isOk ? current : null };
  }
  return failed(true); // too many redirects
}
