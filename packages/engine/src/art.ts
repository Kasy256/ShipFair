import type { EventBus, GeneratedAssetManifest } from '@shipfair/shared';
import type { WebGLRenderer } from 'three';
import { type AssetLoader, AssetManager } from './assets/asset-manager.ts';
import { createGltfLoader } from './assets/gltf-loader.ts';
import { loadPalette, PaletteMaterials } from './assets/palette.ts';
import { AnimationSet } from './avatars/animation-set.ts';
import { CharacterFactory } from './avatars/character-factory.ts';
import { BoothKit } from './booths/kit.ts';
import { PROP_SETS, STREET_LAMP } from './world/prop-plan.ts';
import { PropField } from './world/props.ts';

/**
 * Everything built from `pnpm assets:build` output: the asset manager, shared palette materials,
 * the clip set, the character factory, the booth kit and the props. Every piece degrades to a
 * placeholder on its own, so a missing file (or a missing manifest) never stops the game.
 */
export class Art {
  readonly assets: AssetManager;
  readonly manifest: GeneratedAssetManifest | null;
  readonly materials: PaletteMaterials;
  readonly animations: AnimationSet;
  /** Null without a manifest (no bodies to build from): avatars stay procedural. */
  readonly factory: CharacterFactory | null;
  readonly kit: BoothKit;
  readonly props: PropField;

  private constructor(parts: Omit<Art, 'dispose' | 'canBuildCharacters'>) {
    this.assets = parts.assets;
    this.manifest = parts.manifest;
    this.materials = parts.materials;
    this.animations = parts.animations;
    this.factory = parts.factory;
    this.kit = parts.kit;
    this.props = parts.props;
  }

  static async load(bus: EventBus, renderer: WebGLRenderer, loader?: AssetLoader): Promise<Art> {
    const assets = new AssetManager(bus, loader ?? createGltfLoader(renderer));
    const manifest = await assets.loadManifest();
    const materials = new PaletteMaterials(await loadPalette(manifest?.palette.url ?? null));
    const propIds = manifest
      ? manifest.props.map((p) => p.id)
      : [...new Set([STREET_LAMP, ...Object.values(PROP_SETS).flat()])];
    const [animations, kit, props] = await Promise.all([
      AnimationSet.load(assets, manifest),
      BoothKit.load(assets, manifest, materials),
      PropField.load(assets, manifest, materials, propIds),
    ]);
    const factory = manifest ? new CharacterFactory(assets, manifest) : null;
    return new Art({ assets, manifest, materials, animations, factory, kit, props });
  }

  /** True when a real body and walk/run clips exist, so the glTF avatar can replace the rig. */
  canBuildCharacters(bodyId: string): boolean {
    return this.factory?.hasBody(bodyId) === true && this.animations.canLocomote;
  }

  dispose(): void {
    this.factory?.dispose();
    this.kit.dispose();
    this.props.dispose();
    this.animations.dispose();
    this.materials.dispose();
    this.assets.dispose();
  }
}
