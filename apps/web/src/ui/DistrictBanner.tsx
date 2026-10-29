import { useEffect, useState } from 'react';
import { useUiStore } from '../state/ui-store.ts';
import { useWorldStore } from '../state/world-store.ts';
import { zoneName } from './districts.ts';

/** Matches `--animate-banner` in index.css. */
const BANNER_MS = 2600;

/** The district name, big, for a moment after each `zone:entered`. Static under reduced motion. */
export function DistrictBanner() {
  const districtId = useWorldStore((s) => s.currentDistrictId);
  const districts = useWorldStore((s) => s.districtsById);
  const isReducedMotion = useUiStore((s) => s.isReducedMotion);
  const [shown, setShown] = useState<{ key: number; name: string; color: string | null } | null>(
    null,
  );

  useEffect(() => {
    const district = districtId === null ? undefined : districts.get(districtId);
    setShown((prev) => ({
      key: (prev?.key ?? 0) + 1,
      name: zoneName(districtId, districts),
      color: district?.color ?? null,
    }));
    const timer = setTimeout(() => setShown(null), BANNER_MS);
    return () => clearTimeout(timer);
  }, [districtId, districts]);

  if (!shown) return null;
  return (
    <div
      key={shown.key}
      role="status"
      data-testid="district-banner"
      className={`pointer-events-none absolute inset-x-0 top-20 z-10 text-center ${isReducedMotion ? '' : 'animate-banner'}`}
    >
      <p className="inline-block rounded-2xl bg-ink/75 px-6 py-3 backdrop-blur">
        <span className="block text-muted text-xs uppercase tracking-[0.2em]">Now entering</span>
        <span
          className="font-bold text-3xl"
          style={shown.color ? { color: shown.color } : undefined}
        >
          {shown.name}
        </span>
      </p>
    </div>
  );
}
