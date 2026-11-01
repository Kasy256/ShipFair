import type { BoothStatsDay } from '@shipfair/shared';

// The owner's last 14 days on /me (prompt 13). Visitors and try clicks have different scales,
// so they're two small bar strips sharing the day axis, each titled with its total (never two
// y-axes on one chart). Each bar has a hover title, and a table carries the same numbers for
// screen readers.

const W = 280;
const H = 48;
const GAP = 2;

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

function Strip({
  label,
  values,
  days,
  color,
}: {
  label: string;
  values: readonly number[];
  days: readonly string[];
  color: string;
}) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const barW = (W - GAP * (values.length - 1)) / values.length;
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-semibold tabular-nums">{total}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 h-12 w-full"
        role="img"
        aria-label={`${label}: ${total} over ${values.length} days`}
      >
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="#f5f3ee" strokeOpacity={0.15} />
        {values.map((v, i) => {
          const h = v === 0 ? 0 : Math.max(3, (v / max) * (H - 2));
          const x = i * (barW + GAP);
          return (
            <g key={days[i]}>
              {/* A full-height hit target, so a 0 day still has a tooltip. */}
              <rect x={x} y={0} width={barW} height={H} fill="transparent">
                <title>{`${shortDay(days[i] ?? '')}: ${v}`}</title>
              </rect>
              {h > 0 && (
                <path
                  d={`M${x},${H} v${-(h - 2)} q0,-2 2,-2 h${barW - 4} q2,0 2,2 v${h - 2} z`}
                  fill={color}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function BoothStatsChart({ days }: { days: readonly BoothStatsDay[] }) {
  const labels = days.map((d) => d.day);
  return (
    <div className="mt-3 rounded-lg bg-ink-2 p-3" data-testid="booth-stats">
      <p className="text-muted text-xs">Last {days.length} days</p>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">
        <Strip
          label="Visitors"
          values={days.map((d) => d.visitors)}
          days={labels}
          color="#ffb547"
        />
        <Strip
          label="Try clicks"
          values={days.map((d) => d.tryClicks)}
          days={labels}
          color="#00e5c7"
        />
      </div>
      <table className="sr-only">
        <caption>Daily visitors and try clicks</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Visitors</th>
            <th scope="col">Try clicks</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{shortDay(d.day)}</th>
              <td>{d.visitors}</td>
              <td>{d.tryClicks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
