import { ImageBitmapLoader, LinearMipmapLinearFilter, SRGBColorSpace, Texture } from 'three';
import { MIP_FACTOR } from '../config.ts';

/** A decoded image. ImageBitmaps have `close()`; test fakes needn't. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

/** Fetches and decodes `url`, at most `maxPx` on its longer side. */
export type ImageSource = (url: string, maxPx: number) => Promise<DecodedImage>;

interface Entry {
  readonly url: string;
  texture: Texture | null;
  image: DecodedImage | null;
  bytes: number;
  /** The update pass that last asked for this texture. */
  pass: number;
  /** Monotonic use counter for least-recently-used eviction. */
  used: number;
}

/**
 * The booth texture LRU (ARCHITECTURE.md §4: 48 textures on high, 16 on low). Loaded and
 * in-flight textures both count toward the limit, so it is never exceeded. Callers run one pass
 * at a time (`beginPass`), asking for what they show nearest first; only entries nobody asked for
 * in the current pass are evicted (and disposed), so nothing on screen loses its texture. When
 * every slot is in use the request returns null and the booth keeps its placeholder.
 */
export class TextureCache {
  readonly #entries = new Map<string, Entry>();
  readonly #failed = new Set<string>();
  readonly #inFlight = new Set<Promise<unknown>>();
  readonly #load: ImageSource;
  #max: number;
  #pass = 0;
  #clock = 0;
  #isDisposed = false;
  /** Largest number of entries (loaded + loading) ever held. */
  maxSeen = 0;
  loads = 0;
  evictions = 0;

  constructor(max: number, load: ImageSource) {
    this.#max = max;
    this.#load = load;
  }

  get size(): number {
    return this.#entries.size;
  }

  get max(): number {
    return this.#max;
  }

  get failures(): number {
    return this.#failed.size;
  }

  /** Estimated GPU bytes of the loaded textures. */
  get bytes(): number {
    let n = 0;
    for (const e of this.#entries.values()) n += e.bytes;
    return n;
  }

  setMax(max: number): void {
    this.#max = max;
    while (this.#entries.size > max && this.#evictOne(Number.POSITIVE_INFINITY)) {
      // keep evicting
    }
  }

  beginPass(): void {
    this.#pass++;
  }

  /** Marks `url` as in use this pass without starting a load. */
  touch(url: string): void {
    const entry = this.#entries.get(url);
    if (!entry) return;
    entry.pass = this.#pass;
    entry.used = ++this.#clock;
  }

  /** The texture if loaded; otherwise starts loading when there is room, and returns null. */
  request(url: string, maxPx: number): Texture | null {
    const entry = this.#entries.get(url);
    if (entry) {
      this.touch(url);
      return entry.texture;
    }
    if (this.#isDisposed || this.#failed.has(url)) return null;
    if (this.#entries.size >= this.#max && !this.#evictOne(this.#pass)) return null;
    const fresh: Entry = { url, texture: null, image: null, bytes: 0, pass: this.#pass, used: 0 };
    fresh.used = ++this.#clock;
    this.#entries.set(url, fresh);
    this.maxSeen = Math.max(this.maxSeen, this.#entries.size);
    this.loads++;
    const promise = this.#load(url, maxPx).then(
      (image) => {
        if (this.#isDisposed || this.#entries.get(url) !== fresh) {
          image.close?.();
          return;
        }
        fresh.image = image;
        fresh.texture = createTexture(image);
        fresh.bytes = image.width * image.height * 4 * MIP_FACTOR;
      },
      (error: unknown) => {
        if (this.#entries.get(url) === fresh) this.#entries.delete(url);
        if (!this.#failed.has(url)) {
          console.warn(`Booth image ${url} failed to load; keeping its placeholder.`, error);
        }
        this.#failed.add(url);
      },
    );
    this.#inFlight.add(promise);
    void promise.finally(() => this.#inFlight.delete(promise));
    return null;
  }

  /** Resolves when every load started so far has finished (for tests). */
  async settled(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.all([...this.#inFlight]);
  }

  dispose(): void {
    this.#isDisposed = true;
    for (const entry of this.#entries.values()) release(entry);
    this.#entries.clear();
  }

  /** Evicts the least recently used loaded entry not asked for in pass `pass` or later. */
  #evictOne(pass: number): boolean {
    let victim: Entry | undefined;
    for (const e of this.#entries.values()) {
      if (!e.texture || e.pass >= pass) continue;
      if (!victim || e.used < victim.used) victim = e;
    }
    if (!victim) return false;
    this.#entries.delete(victim.url);
    release(victim);
    this.evictions++;
    return true;
  }
}

function createTexture(image: DecodedImage): Texture {
  const texture = new Texture(image as unknown as ImageBitmap);
  texture.colorSpace = SRGBColorSpace;
  // ImageBitmaps are flipped at decode time (imageOrientation), so no flip on upload.
  texture.flipY = false;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function release(entry: Entry): void {
  entry.texture?.dispose();
  entry.image?.close?.();
  entry.texture = null;
  entry.image = null;
}

/**
 * Loads untrusted booth images off the main thread: fetch with `crossOrigin = 'anonymous'` (no
 * cookies, CORS required) and decode with createImageBitmap, downscaled to `maxPx`.
 */
export function bitmapSource(): ImageSource {
  const loader = new ImageBitmapLoader();
  loader.setCrossOrigin('anonymous');
  loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  return (url, maxPx) =>
    new Promise<ImageBitmap>((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    }).then(async (bitmap) => {
      const longest = Math.max(bitmap.width, bitmap.height);
      if (longest <= maxPx) return bitmap;
      const scale = maxPx / longest;
      const resized = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
        resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
        resizeQuality: 'medium',
      });
      bitmap.close();
      return resized;
    });
}
