import type { BoothChange, Teleport } from '@shipfair/shared';
import { Matrix4 } from 'three';
import type { Engine } from '../engine.ts';
import { districtFrame } from '../world/city-geometry.ts';

export interface CityDistrictInfo {
  id: number;
  slug: string;
  entrance: { x: number; z: number };
  spineEnd: { x: number; z: number };
  outward: { x: number; z: number };
  rect: { minX: number; minZ: number; maxX: number; maxZ: number };
  streets: number;
}

export interface CityStats {
  booths: number;
  /** Booth part instances drawn after the last draw-distance pass. */
  drawnInstances: number;
  signs: number;
  signPages: number;
  contentBooths: number;
  contentMeshes: number;
  cache: {
    size: number;
    max: number;
    maxSeen: number;
    loads: number;
    evictions: number;
    failures: number;
  };
  textureMb: number;
  trees: number;
  props: number;
}

/** `window.__shipfair.city`: the city built from a snapshot, for Playwright. */
export interface CityTestApi {
  readonly isBuilt: boolean;
  /** True once the booth layer exists (the art has loaded). */
  readonly hasBooths: boolean;
  readonly focused: string | null;
  readonly zone: number | null;
  districts(): CityDistrictInfo[];
  stats(): CityStats;
  /** Every drawn booth's world transform (16 numbers, column-major). */
  transforms(): Record<string, number[]>;
  slugs(): Record<string, string>;
  /** What a nearby booth's logo and screens show: image urls, or null for the monogram. */
  content(boothId: string): { logo: string | null; screens: (string | null)[] } | null;
  update(changes: BoothChange[]): void;
  teleport(to: Teleport): void;
  interact(): 'booth' | 'kiosk' | null;
  /** Waits for in-flight booth image loads. */
  settled(): Promise<void>;
}

const matrix = new Matrix4();

export function createCityTestApi(engine: Engine): CityTestApi {
  const city = () => engine.runtime?.city ?? null;
  return {
    get isBuilt() {
      return city() !== null;
    },
    get hasBooths() {
      return city()?.booths != null;
    },
    get focused() {
      return city()?.interaction.focused ?? null;
    },
    get zone() {
      return city()?.interaction.zone ?? null;
    },
    districts() {
      return (city()?.layout.districts ?? []).map((d) => {
        const f = districtFrame(d);
        return {
          id: d.id,
          slug: d.slug,
          entrance: { ...f.entrance },
          spineEnd: { ...f.spineEnd },
          outward: { ...f.outward },
          rect: { ...d.rect },
          streets: d.streetCount,
        };
      });
    },
    stats() {
      const c = city();
      const b = c?.booths;
      const cache = b?.content.cache;
      return {
        booths: b?.boothCount ?? 0,
        drawnInstances: b?.shells.drawn ?? 0,
        signs: b?.signs.count ?? 0,
        signPages: b?.signs.pageCount ?? 0,
        contentBooths: b?.content.boothCount ?? 0,
        contentMeshes: b?.content.meshCount ?? 0,
        cache: {
          size: cache?.size ?? 0,
          max: cache?.max ?? 0,
          maxSeen: cache?.maxSeen ?? 0,
          loads: cache?.loads ?? 0,
          evictions: cache?.evictions ?? 0,
          failures: cache?.failures ?? 0,
        },
        textureMb: Math.round(((c?.textureBytes ?? 0) / (1024 * 1024)) * 10) / 10,
        trees: c?.greenery.treeCount ?? 0,
        props: b?.propCount ?? 0,
      };
    },
    transforms() {
      const out: Record<string, number[]> = {};
      const c = city();
      if (!c?.booths) return out;
      for (const booth of c.model.booths) {
        if (c.booths.shells.boothMatrix(booth.id, matrix)) out[booth.id] = matrix.toArray();
      }
      return out;
    },
    slugs() {
      const out: Record<string, string> = {};
      for (const booth of city()?.model.booths ?? []) out[booth.id] = booth.slug;
      return out;
    },
    content: (boothId) => city()?.booths?.content.shown(boothId) ?? null,
    update: (changes) => engine.updateBooths(changes),
    teleport: (to) => engine.teleport(to),
    interact: () => city()?.interact() ?? null,
    settled: async () => city()?.booths?.content.cache.settled(),
  };
}
