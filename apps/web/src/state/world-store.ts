import type { BoothPublic, District, MakerPublic, WorldSnapshot } from '@shipfair/shared';
import { create } from 'zustand';
import type { WorldSource } from '../lib/world-source.ts';

interface WorldState {
  snapshot: WorldSnapshot | null;
  /** Where booth images live (VITE_MEDIA_HOST, or the fake world's host). */
  mediaHost: string | null;
  boothsById: ReadonlyMap<string, BoothPublic>;
  boothsBySlug: ReadonlyMap<string, BoothPublic>;
  districtsById: ReadonlyMap<number, District>;
  makersById: ReadonlyMap<string, MakerPublic>;
  /** From `zone:entered`; null is the plaza (or not entered yet). */
  currentDistrictId: number | null;
  /** From `booth:focus`; drives the prompt pill. */
  focusedBoothId: string | null;
  setWorld(source: WorldSource): void;
  setDistrict(id: number | null): void;
  setFocusedBooth(id: string | null): void;
}

const empty = new Map();

/** The world as the UI sees it (CODING_STANDARDS.md §5). The engine writes to it via the bus. */
export const useWorldStore = create<WorldState>()((set) => ({
  snapshot: null,
  mediaHost: null,
  boothsById: empty,
  boothsBySlug: empty,
  districtsById: empty,
  makersById: empty,
  currentDistrictId: null,
  focusedBoothId: null,
  setWorld({ snapshot, mediaHost }) {
    const booths = snapshot?.booths ?? [];
    set({
      snapshot: snapshot ?? null,
      mediaHost,
      boothsById: new Map(booths.map((b) => [b.id, b])),
      boothsBySlug: new Map(booths.map((b) => [b.slug, b])),
      districtsById: new Map((snapshot?.districts ?? []).map((d) => [d.id, d])),
      makersById: new Map((snapshot?.makers ?? []).map((m) => [m.id, m])),
      currentDistrictId: null,
      focusedBoothId: null,
    });
  },
  setDistrict: (id) => set({ currentDistrictId: id }),
  setFocusedBooth: (id) => set({ focusedBoothId: id }),
}));
