import {
  type BoothMedia,
  type BoothTier,
  type QualityTier,
  TEXTURE_STREAM_RADIUS_M,
} from '@shipfair/shared';
import {
  type CanvasTexture,
  type Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Texture,
} from 'three';
import {
  CONTENT_UPDATE_S,
  LOGO_MAX_PX,
  MIP_FACTOR,
  MONOGRAM_PX,
  SCREEN_CYCLE_RADIUS_M,
  SCREEN_CYCLE_S,
  SCREENSHOT_MAX_PX,
  TEXTURE_CACHE_MAX,
} from '../config.ts';
import { mediaUrl, monogram } from './media.ts';
import type { BoothShells } from './shells.ts';
import { type ImageSource, TextureCache } from './texture-cache.ts';

/** What content streaming needs to know about a booth. */
export interface ContentBooth {
  readonly id: string;
  readonly name: string;
  readonly tier: BoothTier;
  readonly accent: Color;
  readonly logoKey: string | null;
  readonly media: readonly BoothMedia[];
}

/** A live booth's lot centre (the city keeps this list current). */
export interface ContentAnchor {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

const SCREEN_SLOTS = ['SLOT_screen_0', 'SLOT_screen_1'] as const;
/** Content quads sit in front of their slot, in slot units (slots are 0.02 m deep). */
const SLOT_OFFSET = 0.7;
const MAX_CANDIDATES = 256;
interface Display {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** The cache url currently shown, or null for the monogram. */
  shown: string | null;
}

interface Content {
  readonly booth: ContentBooth;
  readonly group: Group;
  readonly monogram: CanvasTexture;
  readonly logo: Display | null;
  readonly screens: Display[];
  readonly images: string[];
  /** Which screenshot screen 0 shows; screen k shows images[(index + k) % n]. */
  index: number;
  cycleAge: number;
  distance: number;
  pass: number;
}

/**
 * Booth logos and screenshots (ARCHITECTURE.md §4). Only booths within TEXTURE_STREAM_RADIUS_M
 * get content meshes (the one place per-booth meshes are allowed); each shows a generated
 * monogram until its images arrive through the LRU. Screens cycle every SCREEN_CYCLE_S within
 * SCREEN_CYCLE_RADIUS_M. Images come from the media host only.
 */
export class ContentStreamer {
  readonly root = new Group();
  readonly cache: TextureCache;
  readonly #shells: BoothShells;
  readonly #host: string | null;
  readonly #quad = new PlaneGeometry(1, 1).translate(0, 0, SLOT_OFFSET);
  readonly #content = new Map<string, Content>();
  /** The same contents as a plain array, for allocation-free per-frame loops. */
  readonly #list: Content[] = [];
  readonly #ids: string[] = new Array<string>(MAX_CANDIDATES).fill('');
  readonly #dist = new Float32Array(MAX_CANDIDATES);
  #tier: QualityTier;
  #sincePass = Number.POSITIVE_INFINITY;
  #pass = 0;

  constructor(shells: BoothShells, host: string | null, tier: QualityTier, load: ImageSource) {
    this.root.name = 'booth-content';
    this.#shells = shells;
    this.#host = host;
    this.#tier = tier;
    this.cache = new TextureCache(TEXTURE_CACHE_MAX[tier], load);
  }

  get meshCount(): number {
    let n = 0;
    for (const c of this.#list) n += c.screens.length + (c.logo ? 1 : 0);
    return n;
  }

  get boothCount(): number {
    return this.#content.size;
  }

  /** Estimated GPU bytes: cached images plus monograms. */
  get bytes(): number {
    return this.cache.bytes + this.#content.size * MONOGRAM_PX * MONOGRAM_PX * 4 * MIP_FACTOR;
  }

  /** For tests: the image urls a booth's logo and screens show (null = the monogram). */
  shown(id: string): { logo: string | null; screens: (string | null)[] } | null {
    const content = this.#content.get(id);
    if (!content) return null;
    return {
      logo: content.logo?.shown ?? null,
      screens: content.screens.map((s) => s.shown),
    };
  }

  setTier(tier: QualityTier): void {
    this.#tier = tier;
    this.cache.setMax(TEXTURE_CACHE_MAX[tier]);
  }

  /** Drops a booth's content (removed or changed); it is rebuilt on the next pass if in range. */
  forget(id: string): void {
    const content = this.#content.get(id);
    if (!content) return;
    this.#drop(content);
    this.#sincePass = Number.POSITIVE_INFINITY;
  }

  /** Per frame: cycles screens, follows build-up animations and runs a pass every 0.25 s. */
  update(
    dt: number,
    x: number,
    z: number,
    anchors: readonly ContentAnchor[],
    booth: (id: string) => ContentBooth | undefined,
  ): void {
    for (const content of this.#list) {
      if (this.#shells.boothMatrix(content.booth.id, content.group.matrix)) {
        content.group.matrixWorldNeedsUpdate = true;
      }
      if (content.distance > SCREEN_CYCLE_RADIUS_M || content.images.length < 2) continue;
      content.cycleAge += dt;
      if (content.cycleAge >= SCREEN_CYCLE_S) {
        content.cycleAge = 0;
        content.index = (content.index + 1) % content.images.length;
        this.#sincePass = Number.POSITIVE_INFINITY;
      }
    }
    this.#sincePass += dt;
    if (this.#sincePass >= CONTENT_UPDATE_S) this.#runPass(x, z, anchors, booth);
  }

  dispose(): void {
    for (const content of this.#list) this.#disposeContent(content);
    this.#content.clear();
    this.#list.length = 0;
    this.cache.dispose();
    this.#quad.dispose();
    this.root.removeFromParent();
  }

  #runPass(
    x: number,
    z: number,
    anchors: readonly ContentAnchor[],
    booth: (id: string) => ContentBooth | undefined,
  ): void {
    this.#sincePass = 0;
    const pass = ++this.#pass;
    // In-range booths, nearest first (insertion sort into fixed arrays: no allocation).
    const r2 = TEXTURE_STREAM_RADIUS_M * TEXTURE_STREAM_RADIUS_M;
    let n = 0;
    for (const a of anchors) {
      const dx = a.x - x;
      const dz = a.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      let i = Math.min(n, MAX_CANDIDATES - 1);
      if (i === MAX_CANDIDATES - 1 && d2 >= (this.#dist[i] ?? 0)) continue;
      while (i > 0 && (this.#dist[i - 1] ?? 0) > d2) {
        this.#dist[i] = this.#dist[i - 1] ?? 0;
        this.#ids[i] = this.#ids[i - 1] ?? '';
        i--;
      }
      this.#dist[i] = d2;
      this.#ids[i] = a.id;
      n = Math.min(n + 1, MAX_CANDIDATES);
    }
    for (let i = 0; i < n; i++) {
      const id = this.#ids[i] ?? '';
      const data = booth(id);
      if (!data) continue;
      let content = this.#content.get(id);
      if (!content) {
        content = this.#create(data);
        this.#content.set(id, content);
        this.#list.push(content);
      }
      content.pass = pass;
      content.distance = Math.sqrt(this.#dist[i] ?? 0);
    }
    for (let i = this.#list.length - 1; i >= 0; i--) {
      const content = this.#list[i];
      if (content && content.pass !== pass) this.#drop(content);
    }
    // Pin what is on screen first, so a nearer booth never evicts a texture still in use.
    const cache = this.cache;
    cache.beginPass();
    for (const content of this.#list) {
      if (content.logo?.shown) cache.touch(content.logo.shown);
      for (const screen of content.screens) if (screen.shown) cache.touch(screen.shown);
    }
    if (this.#host === null) return;
    const host = this.#host;
    for (let i = 0; i < n; i++) {
      const content = this.#content.get(this.#ids[i] ?? '');
      if (!content) continue;
      const { logoKey } = content.booth;
      if (content.logo && logoKey)
        this.#show(content.logo, mediaUrl(host, logoKey), LOGO_MAX_PX[this.#tier]);
      const count = content.images.length;
      for (let k = 0; k < content.screens.length && count > 0; k++) {
        const screen = content.screens[k];
        const url = content.images[(content.index + k) % count];
        if (screen && url) this.#show(screen, url, SCREENSHOT_MAX_PX[this.#tier]);
      }
    }
  }

  #show(display: Display, url: string, maxPx: number): void {
    if (display.shown === url) return;
    const texture: Texture | null = this.cache.request(url, maxPx);
    if (!texture) return;
    display.mesh.material.map = texture;
    display.shown = url;
  }

  #create(booth: ContentBooth): Content {
    const group = new Group();
    group.name = `content/${booth.id}`;
    group.matrixAutoUpdate = false;
    this.root.add(group);
    const placeholder = monogram(booth.name, booth.accent);
    const display = (slot: string): Display | null => {
      const mesh = new Mesh(this.#quad, new MeshBasicMaterial({ map: placeholder }));
      mesh.matrixAutoUpdate = false;
      if (!this.#shells.slotLocal(booth.tier, slot, mesh.matrix)) {
        mesh.material.dispose();
        return null;
      }
      group.add(mesh);
      return { mesh, shown: null };
    };
    const host = this.#host;
    return {
      booth,
      group,
      monogram: placeholder,
      logo: display('SLOT_logo'),
      screens: SCREEN_SLOTS.map(display).filter((d): d is Display => d !== null),
      images: host
        ? booth.media.filter((m) => m.type === 'image').map((m) => mediaUrl(host, m.key))
        : [],
      index: 0,
      cycleAge: 0,
      distance: 0,
      pass: 0,
    };
  }

  #drop(content: Content): void {
    this.#content.delete(content.booth.id);
    const i = this.#list.indexOf(content);
    if (i >= 0) {
      this.#list[i] = this.#list[this.#list.length - 1] as Content;
      this.#list.length--;
    }
    this.#disposeContent(content);
  }

  #disposeContent(content: Content): void {
    content.group.removeFromParent();
    if (content.logo) content.logo.mesh.material.dispose();
    for (const screen of content.screens) screen.mesh.material.dispose();
    content.monogram.dispose();
  }
}
