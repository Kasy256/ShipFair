import type { Engine } from '@shipfair/engine';
import { useMemo, useState } from 'react';
import { searchBooths } from '../lib/fuzzy.ts';
import { useUiStore } from '../state/ui-store.ts';
import { useWorldStore } from '../state/world-store.ts';
import { CityMap } from './CityMap.tsx';
import { Sheet } from './Sheet.tsx';

const MAX_RESULTS = 8;

interface MapOverlayProps {
  engine: Engine;
}

/** The big map (M): districts to fast-travel to and a booth search that teleports. */
export function MapOverlay({ engine }: MapOverlayProps) {
  const isOpen = useUiStore((s) => s.isMapOpen);
  const setMapOpen = useUiStore((s) => s.setMapOpen);
  return (
    <Sheet
      isOpen={isOpen}
      onClose={() => setMapOpen(false)}
      labelledBy="map-title"
      variant="center"
      testId="map-overlay"
    >
      <MapContents engine={engine} onDone={() => setMapOpen(false)} />
    </Sheet>
  );
}

interface MapContentsProps {
  engine: Engine;
  onDone: () => void;
}

function MapContents({ engine, onDone }: MapContentsProps) {
  const snapshot = useWorldStore((s) => s.snapshot);
  const districts = useWorldStore((s) => s.districtsById);
  const showToast = useUiStore((s) => s.showToast);
  const [query, setQuery] = useState('');
  const layout = engine.layout;
  const booths = snapshot?.booths ?? [];
  const results = useMemo(() => searchBooths(booths, query, MAX_RESULTS), [booths, query]);
  const sorted = useMemo(
    () => [...(snapshot?.districts ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [snapshot],
  );

  const travel = (to: Parameters<Engine['teleport']>[0], name: string) => {
    if (engine.teleport(to)) {
      onDone();
      showToast(`Travelled to ${name}`);
    } else {
      showToast(`${name} isn't in the city right now`);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 id="map-title" className="font-bold text-2xl">
          Map
        </h2>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-3 py-1 font-semibold text-muted hover:text-paper"
        >
          Close map
        </button>
      </div>

      {layout ? (
        <CityMap layout={layout} districts={districts} highlightBoothId={results[0]?.id ?? null} />
      ) : (
        <p className="rounded-xl bg-ink p-6 text-center text-muted">
          There's no city map in this level.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="map-search-label">
          <label id="map-search-label" htmlFor="map-search" className="font-semibold">
            Find a booth
          </label>
          <input
            id="map-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Name or tagline"
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-paper/20 bg-ink px-3 py-2"
          />
          {query.trim() !== '' && (
            <ul aria-label="Search results" className="mt-2 space-y-1">
              {results.length === 0 && (
                <li className="text-muted text-sm">No booth matches “{query}”.</li>
              )}
              {results.map((booth) => (
                <li key={booth.id}>
                  <button
                    type="button"
                    onClick={() => travel({ kind: 'booth', slug: booth.slug }, booth.name)}
                    className="w-full rounded-lg bg-ink-3 px-3 py-2 text-left hover:bg-ink"
                  >
                    <span className="block font-semibold">{booth.name}</span>
                    <span className="block truncate text-muted text-sm">{booth.tagline}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="map-districts">
          <h3 id="map-districts" className="font-semibold">
            Fast travel
          </h3>
          <ul className="mt-1 grid grid-cols-1 gap-1">
            {sorted
              .filter((d) => layout?.districts.some((l) => l.id === d.id) ?? false)
              .map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => travel({ kind: 'district', slug: d.slug }, d.name)}
                    className="flex w-full items-center gap-2 rounded-lg bg-ink-3 px-3 py-2 text-left hover:bg-ink"
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: d.color }}
                    />
                    {d.name}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
