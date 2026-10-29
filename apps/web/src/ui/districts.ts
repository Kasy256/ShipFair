import type { District } from '@shipfair/shared';

/** What the HUD calls the area around the origin (`zone:entered` with `districtId: null`). */
export const PLAZA_NAME = 'Central Plaza';

export function zoneName(id: number | null, districts: ReadonlyMap<number, District>): string {
  return id === null ? PLAZA_NAME : (districts.get(id)?.name ?? PLAZA_NAME);
}
