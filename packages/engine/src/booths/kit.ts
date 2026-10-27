import type { BuiltTier, GeneratedAssetManifest } from '@shipfair/shared';
import {
  BufferAttribute,
  type BufferGeometry,
  type Color,
  InstancedMesh,
  type Material,
  Matrix4,
  type Mesh,
  type Object3D,
} from 'three';
import type { AssetManager } from '../assets/asset-manager.ts';
import type { PaletteMaterials } from '../assets/palette.ts';
import { InstanceSet } from '../render/instance-set.ts';
import { FALLBACK_TIERS, fallbackKitAsset } from './kit-fallback.ts';

/** One booth to draw: its tier, world transform (lot centre, front +Z rotated by facing), tints. */
export interface KitBooth {
  readonly tier: string;
  readonly matrix: Matrix4;
  /** Tints ACCENT parts (instanceColor). */
  readonly accent: Color;
  /** Tints GLOW parts: the district colour. */
  readonly glow: Color;
  /** District theme: parts named `<part>_<theme>` replace `<part>` when the kit has them. */
  readonly theme?: string;
}

type Role = 'palette' | 'accent' | 'glow';
interface PartPrimitive {
  readonly geometry: BufferGeometry;
  readonly role: Role;
}

const ROLE: Readonly<Record<string, Role>> = { PALETTE: 'palette', ACCENT: 'accent', GLOW: 'glow' };
const ASSET_ID = 'booth-kit';

/** Part primitives from the loaded kit scene, keyed by part name (node extras `part`). */
function collectParts(scene: Object3D, aoAttribute: string | null): Map<string, PartPrimitive[]> {
  const parts = new Map<string, PartPrimitive[]>();
  scene.traverse((node) => {
    const part = node.userData.part;
    if (typeof part !== 'string' || parts.has(part)) return;
    const meshes: Mesh[] = (node as Mesh).isMesh
      ? [node as Mesh]
      : (node.children.filter((c) => (c as Mesh).isMesh) as Mesh[]);
    parts.set(
      part,
      meshes.map((mesh) => {
        const geometry = mesh.geometry;
        // `_AO` (custom attribute) becomes the `color` attribute that vertexColors multiplies by.
        const ao = aoAttribute === '_AO' ? geometry.getAttribute('_ao') : undefined;
        if (ao && !geometry.getAttribute('color')) {
          const rgb = new Float32Array(ao.count * 3);
          for (let i = 0; i < ao.count; i++) rgb.fill(ao.getX(i), i * 3, i * 3 + 3);
          geometry.setAttribute('color', new BufferAttribute(rgb, 3));
        }
        const name = (mesh.material as Material).name;
        return { geometry, role: ROLE[name] ?? 'palette' };
      }),
    );
  });
  return parts;
}

/**
 * The booth kit (ARCHITECTURE.md §4): tier layouts and slots come from the generated manifest,
 * part geometry from booth_kit.glb, drawn as one InstancedMesh per part primitive per tier
 * (per theme variant in use). Missing art falls back to a code-built kit with the same slots.
 */
export class BoothKit {
  readonly tiers: ReadonlyMap<string, BuiltTier>;
  readonly isPlaceholder: boolean;
  readonly #parts: ReadonlyMap<string, PartPrimitive[]>;
  readonly #materials: PaletteMaterials;
  readonly #hasAo: boolean;
  readonly #release: () => void;

  private constructor(opts: {
    tiers: readonly BuiltTier[];
    parts: Map<string, PartPrimitive[]>;
    materials: PaletteMaterials;
    hasAo: boolean;
    isPlaceholder: boolean;
    release: () => void;
  }) {
    this.tiers = new Map(opts.tiers.map((t) => [t.id, t]));
    this.#parts = opts.parts;
    this.#materials = opts.materials;
    this.#hasAo = opts.hasAo;
    this.isPlaceholder = opts.isPlaceholder;
    this.#release = opts.release;
  }

  static async load(
    assets: AssetManager,
    manifest: GeneratedAssetManifest | null,
    materials: PaletteMaterials,
  ): Promise<BoothKit> {
    const kit = manifest?.boothKit;
    const asset = await assets.load(ASSET_ID, kit?.url ?? null, fallbackKitAsset);
    // No manifest means no url, so the asset is the code-built fallback in both cases.
    if (!kit || asset.isPlaceholder) {
      return new BoothKit({
        tiers: FALLBACK_TIERS,
        parts: collectParts(asset.scene, null),
        materials,
        hasAo: false,
        isPlaceholder: true,
        release: () => assets.release(ASSET_ID),
      });
    }
    return new BoothKit({
      tiers: kit.tiers,
      parts: collectParts(asset.scene, kit.aoAttribute),
      materials,
      hasAo: kit.aoAttribute !== null,
      isPlaceholder: kit.isPlaceholder,
      release: () => assets.release(ASSET_ID),
    });
  }

  /** Part names available (including theme variants). */
  get partNames(): string[] {
    return [...this.#parts.keys()];
  }

  /** `out` = the world transform of `slot` (e.g. `SLOT_logo`) on `booth`; false if the tier lacks it. */
  slotMatrix(booth: KitBooth, slot: string, out: Matrix4): boolean {
    const found = this.tiers.get(booth.tier)?.slots.find((s) => s.name === slot);
    if (!found) return false;
    out.fromArray(found.matrix).premultiply(booth.matrix);
    return true;
  }

  /** Instanced meshes for `booths`, with a draw distance. The caller disposes the set. */
  build(booths: readonly KitBooth[]): InstanceSet {
    const set = new InstanceSet();
    set.group.name = 'booth-kit';
    // (tier, resolved part) → instance matrices and booth indices.
    const batches = new Map<string, { part: string; matrices: Matrix4[]; booths: number[] }>();
    booths.forEach((booth, b) => {
      const tier = this.tiers.get(booth.tier);
      if (!tier) return;
      for (const placement of tier.parts) {
        const variant = booth.theme ? `${placement.part}_${booth.theme}` : '';
        const part = this.#parts.has(variant) ? variant : placement.part;
        const key = `${tier.id}/${part}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = { part, matrices: [], booths: [] };
          batches.set(key, batch);
        }
        batch.matrices.push(new Matrix4().fromArray(placement.matrix).premultiply(booth.matrix));
        batch.booths.push(b);
      }
    });
    for (const [key, batch] of batches) {
      for (const prim of this.#parts.get(batch.part) ?? []) {
        const mesh = new InstancedMesh(
          prim.geometry,
          this.#material(prim.role),
          batch.matrices.length,
        );
        mesh.name = `${key}/${prim.role}`;
        mesh.castShadow = prim.role !== 'glow';
        mesh.receiveShadow = true;
        const positions = new Float32Array(batch.matrices.length * 2);
        batch.matrices.forEach((m, i) => {
          mesh.setMatrixAt(i, m);
          const booth = booths[batch.booths[i] ?? 0];
          if (booth && prim.role === 'accent') mesh.setColorAt(i, booth.accent);
          if (booth && prim.role === 'glow') mesh.setColorAt(i, booth.glow);
          // Cull by the booth's lot centre, so a booth's parts appear and vanish together.
          positions[i * 2] = booth?.matrix.elements[12] ?? 0;
          positions[i * 2 + 1] = booth?.matrix.elements[14] ?? 0;
        });
        mesh.computeBoundingSphere();
        set.add(mesh, positions);
      }
    }
    return set;
  }

  dispose(): void {
    this.#release();
  }

  #material(role: Role): Material {
    const m = this.#materials;
    if (role === 'glow') return m.glow;
    if (role === 'accent') return this.#hasAo ? m.accentAo : m.accent;
    return this.#hasAo ? m.paletteAo : m.palette;
  }
}
