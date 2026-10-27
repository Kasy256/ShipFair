import type { AssetStats } from '@shipfair/shared';

interface StatsLineProps {
  stats: AssetStats;
  isPlaceholder?: boolean;
  label?: string;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** Triangles, materials, size, bones and the budget verdict (green or red) for one built file. */
export function StatsLine({ stats, isPlaceholder = false, label }: StatsLineProps) {
  const isOver = stats.isOverBudget;
  return (
    <div className="text-xs">
      <p className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
        {label && <span className="font-semibold">{label}</span>}
        <span>{stats.triangles.toLocaleString()} tris</span>
        <span>{stats.materials} mat</span>
        <span>{kb(stats.bytes)}</span>
        {stats.bones > 0 && <span>{stats.bones} bones</span>}
        <span
          data-testid="budget-status"
          data-over={isOver}
          className={isOver ? 'font-semibold text-red-400' : 'font-semibold text-emerald-400'}
        >
          {isOver ? 'over budget' : 'in budget'}
        </span>
        {isPlaceholder && <span className="text-amber-300">placeholder</span>}
      </p>
      {stats.problems.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-red-300">
          {stats.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
