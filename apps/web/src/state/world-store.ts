import type {
  BoothPublic,
  District,
  MakerPublic,
  NetStatus,
  WorldSnapshot,
} from '@shipfair/shared';
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
  /** Multiplayer (prompt 11), from `net:status` and `net:population`. */
  netStatus: NetStatus;
  shard: string | null;
  /** You plus everyone the shard shows you (60 m around). */
  nearbyCount: number;
  /** Everyone online across shards; null until the shard first reports it. */
  onlineCount: number | null;
  /** The shard refused this client's protocol version: the refresh banner. */
  isUpdateRequired: boolean;
  setWorld(source: WorldSource): void;
  /** A newer snapshot of the same world (after `world_update`): the lookups change, the view doesn't. */
  refreshWorld(snapshot: WorldSnapshot): void;
  setNet(status: NetStatus, shard: string | null): void;
  setPopulation(nearby: number, online: number | null): void;
  setUpdateRequired(): void;
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
  netStatus: 'offline',
  shard: null,
  nearbyCount: 1,
  onlineCount: null,
  isUpdateRequired: false,
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
  refreshWorld(snapshot) {
    set({
      snapshot,
      boothsById: new Map(snapshot.booths.map((b) => [b.id, b])),
      boothsBySlug: new Map(snapshot.booths.map((b) => [b.slug, b])),
      districtsById: new Map(snapshot.districts.map((d) => [d.id, d])),
      makersById: new Map(snapshot.makers.map((m) => [m.id, m])),
    });
  },
  setNet: (status, shard) => set({ netStatus: status, shard }),
  setPopulation: (nearby, online) => set({ nearbyCount: nearby, onlineCount: online }),
  setUpdateRequired: () => set({ isUpdateRequired: true }),
  setDistrict: (id) => set({ currentDistrictId: id }),
  setFocusedBooth: (id) => set({ focusedBoothId: id }),
}));
