import type { AssetView, AssetViewer } from '@shipfair/engine';
import type { AssetStats } from '@shipfair/shared';
import { useEffect, useRef } from 'react';
import { StatsLine } from './StatsLine.tsx';

interface AssetCardProps {
  viewer: AssetViewer;
  title: string;
  stats: AssetStats;
  isPlaceholder: boolean;
  /** Adds this card's model to the shared renderer, drawn into `element`. */
  mount: (viewer: AssetViewer, element: HTMLElement) => AssetView;
  children?: React.ReactNode;
}

/** One asset: its own viewport in the shared canvas, plus its numbers. */
export function AssetCard({
  viewer,
  title,
  stats,
  isPlaceholder,
  mount,
  children,
}: AssetCardProps) {
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const view = mount(viewer, element);
    return () => view.dispose();
  }, [viewer, mount]);

  return (
    <article
      data-testid="asset-card"
      data-asset={title}
      className="rounded-lg bg-ink/80 p-2 ring-1 ring-white/10"
    >
      <div ref={viewport} className="aspect-square w-full rounded" />
      <h3 className="mt-2 truncate font-semibold text-sm">{title}</h3>
      <StatsLine stats={stats} isPlaceholder={isPlaceholder} />
      {children}
    </article>
  );
}
