import type { Engine } from '@shipfair/engine';
import { JUST_LAUNCHED_COUNT } from '@shipfair/shared';
import { useMemo } from 'react';
import { mediaUrl } from '../lib/booth-links.ts';
import { useUiStore } from '../state/ui-store.ts';
import { useWorldStore } from '../state/world-store.ts';
import { Sheet } from './Sheet.tsx';

const minutesAgo = (iso: string, now: number) => {
  const minutes = Math.floor(Math.max(0, now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} d ago`;
};

/**
 * The Just Launched wall as a list (interact at the wall): the same newest booths, each a button
 * that takes you there. Keyboard and screen-reader users get the wall this way.
 */
export function LaunchesSheet({ engine }: { engine: Engine }) {
  const isOpen = useUiStore((s) => s.isLaunchesOpen);
  const setOpen = useUiStore((s) => s.setLaunchesOpen);
  const snapshot = useWorldStore((s) => s.snapshot);
  const mediaHost = useWorldStore((s) => s.mediaHost);
  const latest = useMemo(
    () =>
      [...(snapshot?.booths ?? [])]
        .sort((a, b) => Date.parse(b.approvedAt) - Date.parse(a.approvedAt))
        .slice(0, JUST_LAUNCHED_COUNT),
    [snapshot],
  );
  const now = Date.now();
  const go = (slug: string) => {
    setOpen(false);
    engine.teleport({ kind: 'booth', slug });
  };
  return (
    <Sheet
      isOpen={isOpen}
      onClose={() => setOpen(false)}
      labelledBy="launches-title"
      variant="side"
      testId="launches-sheet"
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <h2 id="launches-title" className="font-bold text-2xl">
            Just launched
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="-mt-1 -mr-1 rounded-lg px-2 py-1 text-2xl text-muted leading-none hover:text-paper"
          >
            <span aria-hidden="true">×</span>
            <span className="sr-only">Close the list</span>
          </button>
        </div>
        {latest.length === 0 && <p className="mt-3 text-muted">No booths yet. Be the first!</p>}
        <ol className="mt-3 space-y-2">
          {latest.map((booth) => (
            <li key={booth.id}>
              <button
                type="button"
                onClick={() => go(booth.slug)}
                className="flex w-full items-center gap-3 rounded-xl bg-ink-3 p-2 text-left hover:bg-ink"
              >
                {booth.logoKey && mediaHost ? (
                  <img
                    src={mediaUrl(mediaHost, booth.logoKey) ?? undefined}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-lg object-cover"
                  />
                ) : (
                  <span aria-hidden="true" className="h-10 w-10 rounded-lg bg-ink-2" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{booth.name}</span>
                  <span className="block text-muted text-xs">
                    {minutesAgo(booth.approvedAt, now)}
                  </span>
                </span>
                <span className="text-accent text-sm">
                  Go<span className="sr-only"> to {booth.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </Sheet>
  );
}
