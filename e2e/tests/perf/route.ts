import type { Page } from '@playwright/test';

// The scripted camera route (prompt 05's four positions): the plaza, a district gate looking up
// its spine, the middle of a long spine, and a district's far end looking back over the city.

export type Districts = Awaited<ReturnType<typeof districts>>;

export interface View {
  name: string;
  /** Player position and facing yaw; the camera looks the same way from behind. */
  at: (d: Districts) => { x: number; z: number; yaw: number };
  pitch: number;
  distance: number;
}

export async function districts(page: Page) {
  return page.evaluate(() => window.__shipfair?.city.districts() ?? []);
}

export const along = (d: Districts[number], m: number) => ({
  x: d.entrance.x + d.outward.x * m,
  z: d.entrance.z + d.outward.z * m,
});
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

export const VIEWS: View[] = [
  { name: 'plaza spawn', at: () => ({ x: 0, z: 0, yaw: 0 }), pitch: 0.22, distance: 4.6 },
  {
    name: 'AI Agents gate, up the spine',
    at: (d) => ({ ...along(d[0] as Districts[number], 4), yaw: yawOf(0, 1) }),
    pitch: 0.18,
    distance: 6,
  },
  {
    name: 'Dev Tools mid-spine',
    at: (d) => ({ ...along(d[1] as Districts[number], 180), yaw: yawOf(1, 0) }),
    pitch: 0.3,
    distance: 8,
  },
  {
    name: 'Productivity far end, looking back',
    at: (d) => {
      const p = d[2] as Districts[number];
      return {
        x: p.spineEnd.x - p.outward.x * 4,
        z: p.spineEnd.z - p.outward.z * 4,
        yaw: yawOf(-p.outward.x, -p.outward.z),
      };
    },
    pitch: 0.6,
    distance: 10,
  },
];
