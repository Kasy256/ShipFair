import type { QueueItem } from '@shipfair/shared';

// Small pure helpers for the admin screens (unit tested in admin-format.test.ts).

export type QueueKeyAction = 'approve' | 'reject' | 'next' | 'prev' | 'open';

/** The review queue's shortcuts: A approve, R reject, J/K next/prev, O open the URL. */
const QUEUE_KEYS: Readonly<Record<string, QueueKeyAction>> = {
  a: 'approve',
  r: 'reject',
  j: 'next',
  k: 'prev',
  o: 'open',
};

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: unknown;
}

/** True when keys typed now belong to a text field, not to a shortcut. */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const { tagName, isContentEditable } = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  };
  return (
    isContentEditable === true ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
}

export function queueKeyAction(e: KeyLike): QueueKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return null;
  return QUEUE_KEYS[e.key.toLowerCase()] ?? null;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "12 minutes", "5 hours", "3 days": how long ago `iso` was. */
export function ageText(iso: string, nowMs = Date.now()): string {
  const ms = Math.max(0, nowMs - Date.parse(iso));
  const [n, unit] =
    ms < HOUR_MS
      ? [Math.floor(ms / MINUTE_MS), 'minute']
      : ms < DAY_MS
        ? [Math.floor(ms / HOUR_MS), 'hour']
        : [Math.floor(ms / DAY_MS), 'day'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** Where "Open URL" goes: the address the pre-screen landed on, else the submitted one. */
export const reviewUrl = (item: Pick<QueueItem, 'url' | 'finalUrl'>) => item.finalUrl ?? item.url;

/** A short date and time in the viewer's locale. */
export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
