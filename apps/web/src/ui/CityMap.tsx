import type { CityLayout, District } from '@shipfair/shared';
import { useEffect, useState } from 'react';
import { onPlayerView, playerView } from '../state/player-view.ts';

/** The "You are here" marker moves this often while the map is open (it isn't a game view). */
const MARKER_REFRESH_MS = 250;
const PAD_M = 12;

interface CityMapProps {
  layout: CityLayout;
  districts: ReadonlyMap<number, District>;
  /** Booth to ring (the top search result). */
  highlightBoothId: string | null;
}

/** North-up SVG of the city: +z is up, so SVG y is −z. Decorative; the lists beside it act. */
export function CityMap({ layout, districts, highlightBoothId }: CityMapProps) {
  const [you, setYou] = useState(() => ({ x: playerView.x, z: playerView.z }));

  useEffect(() => {
    let last = 0;
    return onPlayerView(() => {
      const now = performance.now();
      if (now - last < MARKER_REFRESH_MS) return;
      last = now;
      setYou({ x: playerView.x, z: playerView.z });
    });
  }, []);

  const b = layout.bounds;
  const viewBox = `${b.minX - PAD_M} ${-b.maxZ - PAD_M} ${b.maxX - b.minX + PAD_M * 2} ${b.maxZ - b.minZ + PAD_M * 2}`;
  const rect = (r: { minX: number; minZ: number; maxX: number; maxZ: number }) => ({
    x: r.minX,
    y: -r.maxZ,
    width: r.maxX - r.minX,
    height: r.maxZ - r.minZ,
  });

  return (
    <svg
      viewBox={viewBox}
      className="h-auto w-full rounded-xl bg-ink"
      aria-hidden="true"
      data-testid="city-map"
    >
      <rect {...rect(layout.plaza.rect)} fill="#f5f3ee" opacity={0.12} rx={2} />
      {layout.districts.map((d) => {
        const color = districts.get(d.id)?.color ?? '#9aa3c7';
        return (
          <g key={d.id}>
            <rect {...rect(d.rect)} fill={color} opacity={0.18} rx={2} />
            {d.streets.map((s) => (
              <rect key={`${s.minX},${s.minZ}`} {...rect(s)} fill="#f5f3ee" opacity={0.25} />
            ))}
            {d.lots.map((lot) =>
              lot.boothId ? (
                <circle
                  key={lot.boothId}
                  cx={lot.x}
                  cy={-lot.z}
                  r={lot.boothId === highlightBoothId ? 4 : 2}
                  fill={color}
                  stroke={lot.boothId === highlightBoothId ? '#ffffff' : 'none'}
                  strokeWidth={1.5}
                />
              ) : null,
            )}
            <text
              x={(d.rect.minX + d.rect.maxX) / 2}
              y={-(d.rect.minZ + d.rect.maxZ) / 2}
              fill="#f5f3ee"
              fontSize={9}
              fontWeight={700}
              textAnchor="middle"
            >
              {districts.get(d.id)?.name ?? d.slug}
            </text>
          </g>
        );
      })}
      <g data-testid="you-are-here" transform={`translate(${you.x} ${-you.z})`}>
        <circle r={5} fill="#ff4f4f" stroke="#ffffff" strokeWidth={1.5} />
        <text y={-9} fill="#ffffff" fontSize={9} fontWeight={700} textAnchor="middle">
          You are here
        </text>
      </g>
    </svg>
  );
}
