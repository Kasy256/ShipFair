import { type EventBus, GeneratedAssetManifest } from '@shipfair/shared';
import type { AnimationClip, Object3D } from 'three';
import { ASSET_MANIFEST_URL } from '../config.ts';
import { disposeObject } from './dispose.ts';

/** What a loaded file provides (the parts of three's `GLTF` the engine uses). */
export interface LoadedAsset {
  readonly scene: Object3D;
  readonly animations: readonly AnimationClip[];
  readonly isPlaceholder: boolean;
}

/** Fetches and parses one file. The real one is `createGltfLoader`; tests inject fakes. */
export interface AssetLoader {
  load(url: string): Promise<{ scene: Object3D; animations: AnimationClip[] }>;
  dispose?(): void;
}

interface Entry {
  promise: Promise<LoadedAsset>;
  refs: number;
  asset: LoadedAsset | undefined;
}

/**
 * Loads art by id with a promise cache and reference counts. `release(id)` disposes the asset's
 * GPU resources once nobody holds it. A failed load is logged and reported once per id on the bus
 * (`asset:missing`), and the caller gets its placeholder instead, so art never crashes the game.
 */
export class AssetManager {
  readonly #bus: EventBus;
  readonly #loader: AssetLoader;
  readonly #entries = new Map<string, Entry>();
  readonly #missing = new Set<string>();
  #isDisposed = false;
  manifest: GeneratedAssetManifest | null = null;

  constructor(bus: EventBus, loader: AssetLoader) {
    this.#bus = bus;
    this.#loader = loader;
  }

  /** Ids that failed to load (or had no url) this session. */
  get missing(): ReadonlySet<string> {
    return this.#missing;
  }

  /** Number of references held on `id` (0 when not loaded). */
  refs(id: string): number {
    return this.#entries.get(id)?.refs ?? 0;
  }

  /** Fetches and validates the generated manifest. Null (and `asset:missing`) when unusable. */
  async loadManifest(
    url = ASSET_MANIFEST_URL,
    fetchJson: (url: string) => Promise<unknown> = defaultFetchJson,
  ): Promise<GeneratedAssetManifest | null> {
    try {
      const parsed = GeneratedAssetManifest.safeParse(await fetchJson(url));
      if (!parsed.success) throw new Error(`invalid manifest: ${parsed.error.message}`);
      this.manifest = parsed.data;
    } catch (error) {
      this.#report('manifest', url, error);
      this.manifest = null;
    }
    return this.manifest;
  }

  /**
   * Loads `url` under `id` (one fetch however many callers ask) and takes a reference. With no
   * url, or on failure, resolves to `fallback()` (owned by the caller's reference like any asset).
   */
  load(id: string, url: string | null, fallback: () => LoadedAsset): Promise<LoadedAsset> {
    const existing = this.#entries.get(id);
    if (existing) {
      existing.refs++;
      return existing.promise;
    }
    // The callback runs after `entry` exists (a promise never settles synchronously).
    const promise = this.#fetch(id, url, fallback).then((asset) => {
      if (this.#isDisposed || this.#entries.get(id) !== entry) {
        disposeObject(asset.scene);
        return asset;
      }
      entry.asset = asset;
      return asset;
    });
    const entry: Entry = { promise, refs: 1, asset: undefined };
    this.#entries.set(id, entry);
    return entry.promise;
  }

  /** Drops one reference; the last one disposes geometries, materials and textures. */
  release(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    this.#entries.delete(id);
    if (entry.asset) disposeObject(entry.asset.scene);
  }

  dispose(): void {
    this.#isDisposed = true;
    for (const entry of this.#entries.values()) {
      if (entry.asset) disposeObject(entry.asset.scene);
    }
    this.#entries.clear();
    this.#loader.dispose?.();
  }

  async #fetch(id: string, url: string | null, fallback: () => LoadedAsset): Promise<LoadedAsset> {
    if (url === null) {
      this.#report(id, null, new Error('no url in the asset manifest'));
      return fallback();
    }
    try {
      const { scene, animations } = await this.#loader.load(url);
      return { scene, animations, isPlaceholder: false };
    } catch (error) {
      this.#report(id, url, error);
      return fallback();
    }
  }

  #report(id: string, url: string | null, error: unknown): void {
    if (this.#missing.has(id)) return;
    this.#missing.add(id);
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Asset ${id} is missing (${reason}); using its placeholder.`);
    this.#bus.emit('asset:missing', { id, url, reason });
  }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
