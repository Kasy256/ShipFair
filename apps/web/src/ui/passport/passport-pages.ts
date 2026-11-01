import type { District, StampCategory, StampKey } from '@shipfair/shared';
import { BOOTH_STAMPS, SOCIAL_STAMPS } from './stamp-info.ts';

/** Every stamp slot per book page: a slot shows empty until it's stamped. */
export function passportPages(
  districts: readonly District[],
): Record<StampCategory, readonly StampKey[]> {
  return {
    districts: [...districts]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((d): StampKey => `district:${d.slug}`),
    booths: BOOTH_STAMPS,
    social: SOCIAL_STAMPS,
  };
}

/** A small deterministic tilt per stamp, so a page looks hand-stamped. */
export function stampTilt(stamp: string): number {
  let h = 0;
  for (let i = 0; i < stamp.length; i++) h = (h * 31 + stamp.charCodeAt(i)) | 0;
  return (Math.abs(h) % 17) - 8;
}
