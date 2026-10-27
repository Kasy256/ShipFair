import type { GeneratedAssetManifest } from '@shipfair/shared';

export interface MissingEntry {
  id: string;
  reason: string;
}

interface MissingAssetsProps {
  /** `asset:missing` events seen on this page. */
  events: readonly MissingEntry[];
  manifest: GeneratedAssetManifest | null;
}

/** What the artist still owes: failed loads, generated placeholders and substituted clips. */
export function MissingAssets({ events, manifest }: MissingAssetsProps) {
  const rows: MissingEntry[] = [...events];
  if (manifest) {
    for (const c of manifest.characters)
      if (c.isPlaceholder) rows.push({ id: c.id, reason: 'not exported: placeholder capsule' });
    if (manifest.animations.isPlaceholder)
      rows.push({ id: 'humanoid_clips', reason: 'not exported: no clips' });
    for (const [clip, stand] of Object.entries(manifest.animations.substitutes)) {
      rows.push({ id: clip, reason: `clip missing: playing ${stand} instead` });
    }
    if (manifest.boothKit.isPlaceholder)
      rows.push({ id: 'booth_kit', reason: 'not exported: placeholder boxes' });
    for (const p of manifest.props)
      if (p.isPlaceholder) rows.push({ id: p.id, reason: 'not exported: placeholder box' });
  }
  return (
    <section
      aria-labelledby="missing-title"
      className="rounded-lg bg-ink/80 p-3 ring-1 ring-white/10"
    >
      <h2 id="missing-title" className="font-semibold">
        Missing assets ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <p className="text-emerald-400 text-sm">Nothing missing.</p>
      ) : (
        <ul data-testid="missing-assets" className="mt-1 text-sm">
          {rows.map((r) => (
            <li key={`${r.id}:${r.reason}`}>
              <code>{r.id}</code>: {r.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
