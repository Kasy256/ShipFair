import { type AssetView, AssetViewer } from '@shipfair/engine';
import { type AssetStats, createBus, type EngineEvents } from '@shipfair/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AssetCard } from './AssetCard.tsx';
import { CharacterCard } from './CharacterCard.tsx';
import { MissingAssets, type MissingEntry } from './MissingAssets.tsx';
import { WardrobeTable } from './WardrobeTable.tsx';

interface GridEntry {
  key: string;
  title: string;
  stats: AssetStats;
  isPlaceholder: boolean;
  mount: (viewer: AssetViewer, element: HTMLElement) => AssetView;
}

/**
 * /dev/assets (docs/ART_PIPELINE.md Step 6): every built asset in its own viewport with its
 * numbers and budget status, characters with outfit, tint and clip controls, booth tiers with
 * labelled slots, and what is still missing. Dev and staging builds only.
 */
export function DevAssets() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [viewer, setViewer] = useState<AssetViewer>();
  const [missing, setMissing] = useState<MissingEntry[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const bus = createBus<EngineEvents>();
    bus.on('asset:missing', ({ id, reason }) => setMissing((list) => [...list, { id, reason }]));
    let isCurrent = true;
    let created: AssetViewer | undefined;
    AssetViewer.create(element, bus).then(
      (v) => {
        if (!isCurrent) return v.dispose();
        created = v;
        setViewer(v);
      },
      (e: unknown) => setError(String(e)),
    );
    return () => {
      isCurrent = false;
      created?.dispose();
      setViewer(undefined);
    };
  }, []);

  const manifest = viewer?.art.manifest ?? null;
  const grid = useMemo<GridEntry[]>(() => {
    if (!manifest) return [];
    const kit = manifest.boothKit;
    return [
      ...kit.tiers.map((t) => ({
        key: t.id,
        title: `booth_kit · ${t.id}`,
        stats: kit.stats,
        isPlaceholder: kit.isPlaceholder,
        mount: (v: AssetViewer, el: HTMLElement) => v.addTier(el, t.id),
      })),
      ...manifest.props.map((p) => ({
        key: p.id,
        title: `${p.id} (${p.collider})`,
        stats: p.stats,
        isPlaceholder: p.isPlaceholder,
        mount: (v: AssetViewer, el: HTMLElement) => v.addProp(el, p.id),
      })),
    ];
  }, [manifest]);
  const clips = manifest?.animations.clips.map((c) => c.name) ?? [];

  return (
    <main className="relative min-h-dvh bg-[#14161c] p-4 font-sans text-paper">
      {/* One shared canvas behind the cards; each card's viewport is a scissor rectangle. */}
      <canvas ref={canvas} className="pointer-events-none fixed inset-0 z-10 h-full w-full" />
      <header className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="font-bold text-2xl text-accent">Assets</h1>
        <p className="text-sm opacity-80">
          Built by <code>pnpm assets:build</code>. Red means over the budget in art/contract.json.
        </p>
      </header>
      {error && (
        <p role="alert" className="mb-4 rounded bg-red-900/60 p-2">
          {error}
        </p>
      )}
      {!viewer && !error && <p>Loading assets…</p>}
      {viewer && (
        <div className="grid gap-4">
          <MissingAssets events={missing} manifest={manifest} />
          {manifest && (
            <section
              aria-labelledby="animations-title"
              className="rounded-lg bg-ink/80 p-3 text-sm ring-1 ring-white/10"
            >
              <h2 id="animations-title" className="font-semibold">
                humanoid_clips ({manifest.animations.clips.length} clips,{' '}
                {(manifest.animations.stats.bytes / 1024).toFixed(1)} KB)
              </h2>
              <p className="tabular-nums">
                {manifest.animations.clips
                  .map((c) => `${c.name} ${c.durationS.toFixed(2)} s`)
                  .join(' · ')}
              </p>
            </section>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
            {manifest?.characters.map((c) => (
              <CharacterCard key={c.id} viewer={viewer} character={c} clips={clips} />
            ))}
            {grid.map((g) => (
              <AssetCard
                key={g.key}
                viewer={viewer}
                title={g.title}
                stats={g.stats}
                isPlaceholder={g.isPlaceholder}
                mount={g.mount}
              />
            ))}
          </div>
          {manifest && <WardrobeTable items={manifest.wardrobe} />}
        </div>
      )}
    </main>
  );
}
