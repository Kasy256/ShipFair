import { BufferAttribute, BufferGeometry, Uint16BufferAttribute } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One skinned piece of an avatar: the body, a garment, hair, … all on the same skeleton. */
export interface AvatarPart {
  readonly geometry: BufferGeometry;
  /** Replaces every vertex's region (legacy bodies paint regions per material). */
  readonly region?: number;
  /** Moves vertices of region `from` to `to` (facial hair → the FACIAL slot). */
  readonly remap?: { readonly from: number; readonly to: number };
}

/** Attributes every merged avatar has, as [name, item size]. Missing ones are filled. */
const LAYOUT: readonly (readonly [string, number])[] = [
  ['position', 3],
  ['normal', 3],
  ['skinIndex', 4],
  ['skinWeight', 4],
  ['_region', 1],
  ['_mask', 1],
  ['_uv_print', 2],
];
/** Outside [0, 1], so parts without a print UV never show the print. */
const NO_PRINT = -1;

/**
 * Copies one part into plain float (and uint16 joint) attributes. Built files quantize normals
 * and weights per file, and `mergeGeometries` needs identical array types, so everything is
 * dequantized here. Runs once per item combination, never per frame.
 */
export function normalisePart(part: AvatarPart): BufferGeometry {
  const src = part.geometry;
  const count = src.getAttribute('position').count;
  const out = new BufferGeometry();
  for (const [name, size] of LAYOUT) {
    const from = src.getAttribute(name) as BufferAttribute | undefined;
    const array =
      name === 'skinIndex' ? new Uint16Array(count * size) : new Float32Array(count * size);
    if (from) {
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < size; c++) array[i * size + c] = from.getComponent(i, c);
      }
    } else if (name === '_uv_print') array.fill(NO_PRINT);
    else if (name === 'skinWeight') for (let i = 0; i < count; i++) array[i * size] = 1;
    if (name === '_region' && part.region !== undefined) array.fill(part.region);
    if (name === '_region' && part.remap) {
      for (let i = 0; i < count; i++) if (array[i] === part.remap.from) array[i] = part.remap.to;
    }
    out.setAttribute(
      name,
      name === 'skinIndex'
        ? new Uint16BufferAttribute(array, size)
        : new BufferAttribute(array, size),
    );
  }
  const index = src.getIndex();
  const indices = new Uint32Array(index ? index.count : count);
  for (let i = 0; i < indices.length; i++) indices[i] = index ? index.getX(i) : i;
  out.setIndex(new BufferAttribute(indices, 1));
  return out;
}

/** One geometry for the whole avatar: one draw call, one skeleton. */
export function mergeAvatarParts(parts: readonly AvatarPart[]): BufferGeometry {
  const normalised = parts.map(normalisePart);
  const merged = mergeGeometries(normalised, false);
  for (const g of normalised) g.dispose();
  if (!merged) throw new Error('avatar parts could not be merged');
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
