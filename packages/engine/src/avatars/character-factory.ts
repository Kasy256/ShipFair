import {
  type AvatarStyleV2,
  type BuiltWardrobeItem,
  type GeneratedAssetManifest,
  isHairVisible,
  resolveHeadwear,
} from '@shipfair/shared';
import { type BufferGeometry, Group, type Object3D, type SkinnedMesh } from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { AssetManager, LoadedAsset } from '../assets/asset-manager.ts';
import { hiddenMasks, MATERIAL_REGION, REGION } from './avatar-colors.ts';
import { Character } from './character.ts';
import { type AvatarPart, mergeAvatarParts } from './merge.ts';

export type Lod = 0 | 1;

interface Merged {
  promise: Promise<BufferGeometry>;
  refs: number;
  bodyAssetId: string;
}

const empty = (): LoadedAsset => ({ scene: new Group(), animations: [], isPlaceholder: true });
const NONE = 'none';

/** Skinned meshes under `root`, with the name of the glTF node they came from. */
function skinnedMeshes(root: Object3D): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) out.push(o as SkinnedMesh);
  });
  return out;
}

/**
 * True when the mesh came from a glTF node named in `names`. A single-primitive node loads as the
 * mesh itself (named after the node); a multi-primitive one as a group carrying the node name.
 */
const isNamed = (mesh: Object3D, names: ReadonlySet<string>): boolean =>
  names.has(mesh.name) || (mesh.parent !== null && names.has(mesh.parent.name));

/**
 * Builds avatars from the generated asset manifest (ARCHITECTURE.md §4): body + wardrobe items
 * merged into one skinned mesh on one cloned skeleton, coloured by the region-id material.
 * Merged geometry is cached by item set, so avatars wearing the same items share it.
 */
export class CharacterFactory {
  readonly #assets: AssetManager;
  readonly #manifest: GeneratedAssetManifest;
  readonly #merged = new Map<string, Merged>();

  constructor(assets: AssetManager, manifest: GeneratedAssetManifest) {
    this.#assets = assets;
    this.#manifest = manifest;
  }

  /** True when `bodyId` is a real (non-placeholder) export. */
  hasBody(bodyId: string): boolean {
    return this.#manifest.characters.some((c) => c.id === bodyId && !c.isPlaceholder);
  }

  /** The built items a v2 style wears on its body (hidden hair and `none` slots left out). */
  itemsFor(input: AvatarStyleV2): BuiltWardrobeItem[] {
    const style = resolveHeadwear(input);
    const body = `body_${style.body}`;
    const wanted: [BuiltWardrobeItem['kind'], string][] = [
      ['top', style.top.item],
      ['bottom', style.bottom.item],
      ['shoes', style.shoes.item],
      ['accessory', style.accessory.item],
      ['facial', style.facial.item],
      ['headwear', style.headwear.item],
    ];
    if (isHairVisible(style)) wanted.push(['hair', style.hair.item]);
    return wanted.flatMap(([kind, id]) => {
      if (id === NONE) return [];
      const item = this.#manifest.wardrobe.find(
        (w) => w.kind === kind && w.id === id && w.body === body,
      );
      return item ? [item] : [];
    });
  }

  /** Item-set key for a v2 style at a LOD (colours don't count). */
  keyFor(style: AvatarStyleV2, lod: Lod): string {
    const items = this.itemsFor(style).map((i) => `${i.kind}:${i.id}`);
    return `v2|body_${style.body}|${lod}|${items.join('|')}`;
  }

  async create(style: AvatarStyleV2, lod: Lod): Promise<Character> {
    const bodyId = `body_${style.body}`;
    const items = this.itemsFor(style);
    const key = this.keyFor(style, lod);
    const character = await this.#assemble(key, bodyId, lod, hiddenMasks(items), (body) =>
      this.#mergeV2(body, bodyId, items, lod),
    );
    character.setColors(style);
    return character;
  }

  /**
   * The legacy path for a body file's own hairs and accessories (shown and hidden by name, regions
   * from material names). The dev page uses it to inspect `art/manifest.json` characters as-is.
   */
  async createLegacy(bodyId: string, show: readonly string[], lod: Lod): Promise<Character> {
    const key = `legacy|${bodyId}|${lod}|${[...show].sort().join('|')}`;
    const entry = this.#manifest.characters.find((c) => c.id === bodyId);
    const optional = new Set([...(entry?.hairs ?? []), ...(entry?.accessories ?? [])]);
    const shown = new Set(show);
    return this.#assemble(key, bodyId, lod, { body: 0, hair: 0 }, async (body) =>
      mergeAvatarParts(
        skinnedMeshes(body.scene)
          .filter((m) => !isNamed(m, optional) || isNamed(m, shown))
          .map((m) => ({
            geometry: m.geometry,
            region: MATERIAL_REGION[(m.material as { name: string }).name] ?? REGION.SKIN,
          })),
      ),
    );
  }

  dispose(): void {
    for (const [key, entry] of this.#merged) {
      this.#merged.delete(key);
      void entry.promise.then((g) => g.dispose());
      this.#assets.release(entry.bodyAssetId);
    }
  }

  #bodyAsset(bodyId: string, lod: Lod): { id: string; promise: Promise<LoadedAsset> } {
    const entry = this.#manifest.characters.find((c) => c.id === bodyId);
    const url = entry ? (lod === 0 ? entry.url : entry.lod1.url) : null;
    const id = `body:${bodyId}:${lod}`;
    return { id, promise: this.#assets.load(id, url, empty) };
  }

  async #mergeV2(
    body: LoadedAsset,
    bodyId: string,
    items: readonly BuiltWardrobeItem[],
    lod: Lod,
  ): Promise<BufferGeometry> {
    const entry = this.#manifest.characters.find((c) => c.id === bodyId);
    const hairs = new Set(entry?.hairs ?? []);
    const parts: AvatarPart[] = skinnedMeshes(body.scene)
      .filter((m) => !isNamed(m, hairs))
      .map((m) => ({ geometry: m.geometry }));
    const loaded = await Promise.all(
      items.map((item) => {
        const id = `item:${item.kind}:${item.id}:${item.body}:${lod}`;
        return this.#assets
          .load(id, lod === 0 ? item.url : item.lod1.url, empty)
          .then((asset) => ({ id, item, asset }));
      }),
    );
    for (const { item, asset } of loaded) {
      const remap = item.kind === 'facial' ? { from: REGION.HAIR, to: REGION.FACIAL } : undefined;
      for (const m of skinnedMeshes(asset.scene))
        parts.push(remap ? { geometry: m.geometry, remap } : { geometry: m.geometry });
    }
    try {
      return mergeAvatarParts(parts);
    } finally {
      // The merged copy owns its data; item files are only needed again for a new combination.
      for (const { id } of loaded) this.#assets.release(id);
    }
  }

  async #assemble(
    key: string,
    bodyId: string,
    lod: Lod,
    hidden: { body: number; hair: number },
    build: (body: LoadedAsset) => Promise<BufferGeometry>,
  ): Promise<Character> {
    const body = this.#bodyAsset(bodyId, lod);
    let merged = this.#merged.get(key);
    if (merged) {
      merged.refs++;
      this.#assets.release(body.id); // the cache entry already holds the body
    } else {
      const promise = body.promise.then(build);
      merged = { promise, refs: 1, bodyAssetId: body.id };
      this.#merged.set(key, merged);
    }
    const entry = merged;
    try {
      const [geometry, asset] = await Promise.all([entry.promise, body.promise]);
      const root = cloneSkinned(asset.scene);
      const meshes = skinnedMeshes(root);
      const first = meshes[0];
      if (!first) throw new Error(`${bodyId} has no skinned mesh`);
      const parent = first.parent ?? root;
      for (const m of meshes) m.removeFromParent();
      return new Character({
        root,
        skeleton: first.skeleton,
        parent,
        geometry,
        bindMatrix: first.bindMatrix,
        key,
        bodyId,
        lod,
        hidden,
        onRelease: () => this.#release(key, entry),
      });
    } catch (error) {
      this.#release(key, entry);
      throw error;
    }
  }

  #release(key: string, entry: Merged): void {
    entry.refs--;
    if (entry.refs > 0 || this.#merged.get(key) !== entry) return;
    this.#merged.delete(key);
    void entry.promise.then(
      (g) => g.dispose(),
      () => undefined,
    );
    this.#assets.release(entry.bodyAssetId);
  }
}
