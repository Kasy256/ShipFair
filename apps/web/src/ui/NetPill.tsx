import type { NetStatus } from '@shipfair/shared';
import { useWorldStore } from '../state/world-store.ts';

const LABEL: Record<NetStatus, string> = {
  connecting: 'Connecting…',
  online: 'Connected',
  reconnecting: 'Reconnecting…',
  offline: 'Offline, exploring solo',
};

const DOT: Record<NetStatus, string> = {
  connecting: 'bg-amber-300',
  online: 'bg-emerald-400',
  reconnecting: 'bg-amber-300 motion-safe:animate-pulse',
  offline: 'bg-muted',
};

/** The connection pill and the visitor counts (nearby from the shard, total across shards). */
export function NetPill() {
  const status = useWorldStore((s) => s.netStatus);
  const nearby = useWorldStore((s) => s.nearbyCount);
  const online = useWorldStore((s) => s.onlineCount);
  return (
    <div className="text-xs" data-testid="net-pill" data-status={status}>
      <p role="status" aria-live="polite" className="text-muted">
        <span
          aria-hidden="true"
          className={`mr-1 inline-block h-2 w-2 rounded-full ${DOT[status]}`}
        />
        {LABEL[status]}
      </p>
      {status === 'online' && (
        <p className="text-paper" data-testid="visitor-count">
          <span data-testid="visitors-nearby">{nearby}</span> nearby
          {online !== null && (
            <>
              {' · '}
              <span data-testid="visitors-online">{online}</span> online
            </>
          )}
        </p>
      )}
    </div>
  );
}
