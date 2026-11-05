// PII scrubbing for error reports (Sentry's `beforeSend` / `beforeBreadcrumb`, browser and both
// Workers). No chat text and no email addresses ever leave for Sentry (prompt 15). Structural
// only, so it works on any Sentry event shape without importing Sentry here.

const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi;
/** Keys whose values are dropped wherever they appear: chat lines, notes, credentials. */
const DROP_KEYS = new Set([
  'text',
  'chat',
  'context',
  'lines',
  'note',
  'email',
  'password',
  'authorization',
  'cookie',
  'cookies',
  'set-cookie',
  'apikey',
  'x-api-key',
  'token',
  'access_token',
  'refresh_token',
]);
export const FILTERED = '[Filtered]';
const MAX_DEPTH = 12;

/** Replaces email addresses in a string. */
export function scrubText(text: string): string {
  return text.replace(EMAIL, FILTERED);
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = DROP_KEYS.has(key.toLowerCase()) ? FILTERED : scrubValue(inner, depth + 1);
  }
  return out;
}

/** Deep copy with emails replaced and sensitive keys' values dropped. */
export function scrubPii<T>(value: T): T {
  return scrubValue(value, 0) as T;
}

interface ScrubbableEvent {
  user?: { id?: unknown; [key: string]: unknown } | null;
  request?: { data?: unknown; [key: string]: unknown };
  breadcrumbs?: { category?: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

/** Breadcrumbs that can carry what someone typed. */
const DROPPED_CATEGORIES = new Set(['ui.input']);

export function scrubBreadcrumb<T extends { category?: string } | null>(crumb: T): T | null {
  if (!crumb || DROPPED_CATEGORIES.has(crumb.category ?? '')) return null;
  return scrubPii(crumb);
}

/**
 * Sentry `beforeSend`: keeps only the user's opaque id (no email, IP or name), drops typing
 * breadcrumbs, request bodies and chat-like fields, and blanks emails in every string.
 */
export function scrubEvent<T extends object>(event: T): T {
  const { user, breadcrumbs, request, ...rest } = event as ScrubbableEvent;
  const out: Record<string, unknown> = scrubPii(rest);
  const id = user?.id;
  if (typeof id === 'string' || typeof id === 'number') out.user = { id };
  if (breadcrumbs) {
    out.breadcrumbs = scrubPii(
      breadcrumbs.filter((b) => !DROPPED_CATEGORIES.has(b.category ?? '')),
    );
  }
  // Request bodies can hold anything a form sent (guestbook text, report notes).
  if (request) {
    const { data: _body, ...meta } = request;
    out.request = scrubPii(meta);
  }
  return out as T;
}
