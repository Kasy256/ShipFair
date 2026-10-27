import type { BuiltWardrobeItem } from '@shipfair/shared';

interface WardrobeTableProps {
  items: readonly BuiltWardrobeItem[];
}

const kb = (bytes: number) => (bytes / 1024).toFixed(1);

/** Every 04c item file with its LOD0/LOD1 numbers (they show on the characters above). */
export function WardrobeTable({ items }: WardrobeTableProps) {
  return (
    <section
      aria-labelledby="wardrobe-title"
      className="rounded-lg bg-ink/80 p-3 ring-1 ring-white/10"
    >
      <h2 id="wardrobe-title" className="font-semibold">
        Wardrobe items ({items.length} files)
      </h2>
      <div className="mt-2 max-h-96 overflow-auto">
        <table className="w-full text-left text-xs tabular-nums">
          <thead className="sticky top-0 bg-ink">
            <tr>
              <th scope="col">item</th>
              <th scope="col">body</th>
              <th scope="col">tris</th>
              <th scope="col">LOD1 tris</th>
              <th scope="col">LOD1 error</th>
              <th scope="col">KB</th>
              <th scope="col">budget</th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={`${w.kind}:${w.id}:${w.body}`} data-testid="wardrobe-row">
                <td>
                  {w.kind}/{w.id}
                </td>
                <td>{w.body.replace('body_', '')}</td>
                <td>{w.stats.triangles}</td>
                <td>{w.lod1.stats.triangles}</td>
                <td>{w.lod1.error}</td>
                <td>{kb(w.stats.bytes)}</td>
                <td className={w.stats.isOverBudget ? 'text-red-400' : 'text-emerald-400'}>
                  {w.stats.isOverBudget ? 'over' : 'ok'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
