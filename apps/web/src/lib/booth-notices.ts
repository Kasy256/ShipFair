import type { BoothOwn } from '@shipfair/shared';
import * as z from 'zod';

// In-world toasts for a maker's review results (prompt 09 §8). The browser remembers what it last
// told the maker about each booth; anything new is announced the next time they enter the city.

/** What a maker was last told, per booth id. Stored in localStorage, so parsed on the way in. */
export const SeenBooths = z.record(z.string(), z.string().max(120));
export type SeenBooths = z.infer<typeof SeenBooths>;

/** A booth this device never saw only gets a toast if staff decided within this window. */
export const NOTICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const signature = (b: BoothOwn) =>
  `${b.status}|${b.revision ? `${b.revision.id}:${b.revision.status}` : ''}`;

const reason = (text: string | null) => (text ? `: ${text}` : '.');

function noticeFor(booth: BoothOwn, before: string | undefined): string | null {
  const [status, revision = ''] = (before ?? '').split('|');
  const name = `“${booth.name}”`;
  if (booth.status !== status) {
    if (booth.status === 'approved' && status !== 'hidden') return `${name} is live in the city!`;
    if (booth.status === 'approved') return `${name} is back in the city.`;
    if (booth.status === 'rejected') return `${name} needs changes${reason(booth.rejectReason)}`;
    if (booth.status === 'hidden') return `${name} is hidden while a moderator looks at reports.`;
  }
  const r = booth.revision;
  if (r && `${r.id}:${r.status}` !== revision) {
    if (r.status === 'approved') return `Your edit to ${name} is live.`;
    if (r.status === 'rejected')
      return `Your edit to ${name} needs changes${reason(r.rejectReason)}`;
  }
  return null;
}

/** New review results since `seen`, and what to remember afterwards. */
export function boothNotices(
  booths: readonly BoothOwn[],
  seen: SeenBooths,
  nowMs = Date.now(),
): { notices: string[]; seen: SeenBooths } {
  const notices: string[] = [];
  const next: SeenBooths = {};
  for (const booth of booths) {
    const before = seen[booth.id];
    next[booth.id] = signature(booth);
    if (before === next[booth.id]) continue;
    const isRecent = nowMs - Date.parse(booth.updatedAt) <= NOTICE_WINDOW_MS;
    if (before === undefined && !isRecent) continue;
    const notice = noticeFor(booth, before);
    if (notice) notices.push(notice);
  }
  return { notices, seen: next };
}
