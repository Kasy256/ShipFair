import type { Engine } from '@shipfair/engine';
import { SHARE_PANEL_DELAY_S, Slug } from '@shipfair/shared';
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { track } from '../lib/analytics.ts';
import { useUiStore } from './ui-store.ts';
import { useWorldStore } from './world-store.ts';

interface Arrival {
  key: string;
  isFound: boolean;
}

/**
 * `/b/:slug` spawns in front of the booth and opens its panel 1.5 s after entering;
 * `/d/:district` spawns at the district gate (ARCHITECTURE.md §8, "Share link"). The teleport
 * happens as soon as the city exists, so the first thing seen after "Enter" is the booth. What
 * happens next (the panel, or a "not found" toast) waits until the visitor has entered.
 */
export function useDeepLinks(engine: Engine | undefined, hasEntered: boolean): void {
  const { slug, district } = useParams();
  const arrival = useRef<Arrival | null>(null);
  const key = slug ? `b/${slug}` : district ? `d/${district}` : null;

  useEffect(() => {
    if (!engine || key === null || arrival.current?.key === key) return;
    const to = slug
      ? ({ kind: 'booth', slug } as const)
      : ({ kind: 'district', slug: district ?? '' } as const);
    const isFound = Slug.safeParse(to.slug).success && engine.teleport(to);
    arrival.current = { key, isFound };
    if (slug) track({ name: 'share_link_opened', props: { slug, found: isFound } });
  }, [engine, key, slug, district]);

  useEffect(() => {
    const landed = arrival.current;
    if (!engine || !hasEntered || !landed || landed.key !== key) return;
    const ui = useUiStore.getState();
    if (!landed.isFound) {
      ui.showToast(
        slug
          ? "That booth isn't in the city. Here's the plaza instead."
          : "That district isn't open yet. Here's the plaza instead.",
      );
      return;
    }
    const booth = slug ? useWorldStore.getState().boothsBySlug.get(slug) : undefined;
    if (!booth) return;
    const timer = setTimeout(() => {
      useUiStore.getState().openBooth(booth.id);
      track({ name: 'booth_open', props: { boothId: booth.id, source: 'share_link' } });
    }, SHARE_PANEL_DELAY_S * 1000);
    return () => clearTimeout(timer);
  }, [engine, hasEntered, key, slug]);
}
