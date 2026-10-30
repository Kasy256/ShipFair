import type { LogEntry } from '@shipfair/shared';
import { when } from './admin-format.ts';

/** Detail values worth a glance in a table cell; the rest stays in the database. */
function detailText(detail: LogEntry['detail']): string {
  return Object.entries(detail)
    .filter(
      ([, value]) =>
        value !== null && value !== '' && !(Array.isArray(value) && value.length === 0),
    )
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ');
}

/** Moderation log rows, newest first. */
export function LogTable({ entries }: { entries: readonly LogEntry[] }) {
  if (entries.length === 0) return <p className="text-muted text-sm">Nothing logged.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid="log-table">
        <thead className="text-muted">
          <tr>
            <th className="py-1 pr-3 font-semibold">When</th>
            <th className="py-1 pr-3 font-semibold">Who</th>
            <th className="py-1 pr-3 font-semibold">Action</th>
            <th className="py-1 pr-3 font-semibold">Target</th>
            <th className="py-1 font-semibold">Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-ink-3 border-t align-top" data-testid="log-row">
              <td className="whitespace-nowrap py-1 pr-3">{when(e.createdAt)}</td>
              <td className="py-1 pr-3">{e.actorHandle ? `@${e.actorHandle}` : 'system'}</td>
              <td className="py-1 pr-3 font-semibold">{e.action}</td>
              <td className="break-all py-1 pr-3">
                {e.targetType} {e.targetId}
              </td>
              <td className="break-all py-1 text-muted">{detailText(e.detail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
