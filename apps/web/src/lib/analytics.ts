// Product events (INFRASTRUCTURE.md §8). PostHog is wired in prompt 15; until then events are
// kept in memory, and non-production builds expose them as `window.__shipfairEvents` for e2e.

export type AnalyticsEvent =
  | { name: 'world_loaded'; props: { loadMs: number; tier: string; booths: number } }
  | { name: 'booth_open'; props: { boothId: string; source: 'walk' | 'share_link' } }
  | { name: 'booth_try_click'; props: { boothId: string } }
  | { name: 'share_link_opened'; props: { slug: string; found: boolean } }
  | { name: 'submit_started'; props: { isEdit: boolean } }
  | {
      name: 'submit_completed';
      props: { boothId: string; kind: 'booth' | 'revision'; score: number };
    };

const MAX_BUFFERED = 200;
const buffer: AnalyticsEvent[] = [];

export function track(event: AnalyticsEvent): void {
  buffer.push(event);
  if (buffer.length > MAX_BUFFERED) buffer.shift();
  if (import.meta.env.MODE !== 'production') window.__shipfairEvents = buffer;
}
