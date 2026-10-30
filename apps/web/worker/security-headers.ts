// One source for the site's security headers. The Worker sets them on what it serves (`/api`,
// `/b/:slug`); static assets never reach the Worker, so the build writes the same values into
// `_headers` (vite.config.ts). Hosts come from the public VITE_* build values.

export interface SecurityHosts {
  /** VITE_MEDIA_HOST, e.g. `media.shipfair.xyz`. */
  mediaHost?: string | undefined;
  /** VITE_SUPABASE_URL, e.g. `https://abc.supabase.co`. */
  supabaseUrl?: string | undefined;
  /** VITE_REALTIME_HOST, e.g. `rt.shipfair.xyz` or `localhost:1999`. */
  realtimeHost?: string | undefined;
  /** Vite dev serves an inline React Refresh preamble and an HMR socket. */
  isDev: boolean;
}

const TURNSTILE = 'https://challenges.cloudflare.com';
const SENTRY = [
  'https://*.ingest.sentry.io',
  'https://*.ingest.us.sentry.io',
  'https://*.ingest.de.sentry.io',
];
const POSTHOG = 'https://*.posthog.com';
/** Presigned booth media uploads go straight to R2's S3 endpoint (prompt 08). */
const R2_UPLOADS = 'https://*.r2.cloudflarestorage.com';

const originOf = (url: string | undefined): string[] => {
  if (!url) return [];
  try {
    return [new URL(url).origin];
  } catch {
    return [];
  }
};

/** Loopback hosts (local wrangler dev) use plain http/ws. */
const isLocal = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

export function contentSecurityPolicy(hosts: SecurityHosts): string {
  const media = hosts.mediaHost ? [`https://${hosts.mediaHost}`] : [];
  const realtime = hosts.realtimeHost
    ? isLocal(hosts.realtimeHost)
      ? [`http://${hosts.realtimeHost}`, `ws://${hosts.realtimeHost}`]
      : [`https://${hosts.realtimeHost}`, `wss://${hosts.realtimeHost}`]
    : [];
  const devScript = hosts.isDev ? ["'unsafe-inline'"] : [];
  const devConnect = hosts.isDev ? ['ws:', 'http://localhost:*', 'http://127.0.0.1:*'] : [];
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Rapier's compat build instantiates WebAssembly from bytes.
    'script-src': ["'self'", "'wasm-unsafe-eval'", TURNSTILE, POSTHOG, ...devScript],
    // React sets dynamic `style` attributes (joystick, progress bar).
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...media],
    'media-src': ["'self'", 'blob:', ...media],
    'font-src': ["'self'"],
    // ImageBitmapLoader fetches booth images, so the media host is a connect source too.
    'connect-src': [
      "'self'",
      ...originOf(hosts.supabaseUrl),
      ...realtime,
      ...media,
      R2_UPLOADS,
      ...SENTRY,
      POSTHOG,
      ...devConnect,
    ],
    'frame-src': [TURNSTILE],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export function securityHeaders(hosts: SecurityHosts): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(hosts),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

/**
 * The static assets' `_headers` file: security headers everywhere, and a year of immutable
 * caching for hashed files under /assets/ (INFRASTRUCTURE.md §6). index.html keeps the default
 * revalidating cache.
 */
export function headersFile(hosts: SecurityHosts): string {
  const lines = ['/*'];
  for (const [name, value] of Object.entries(securityHeaders(hosts)))
    lines.push(`  ${name}: ${value}`);
  lines.push('/assets/*', '  Cache-Control: public, max-age=31536000, immutable', '');
  return lines.join('\n');
}
