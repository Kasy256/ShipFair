// LOD1 by meshoptimizer's simplifier. Simplification only re-indexes existing vertices, so skin
// weights, `_REGION` and `_MASK` carry over untouched. Borders are locked where possible so
// seams between material regions (and garment hems) don't open.
import type { Document, Node } from '@gltf-transform/core';
import { cloneDocument, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { primitiveTriangles } from './stats.ts';

/** Largest relative error the simplifier may accept while chasing the triangle target. */
const MAX_SEARCH_ERROR = 0.1;
export const LOD1_SUFFIX = '_LOD1';

export interface SimplifyResult {
  /** Worst relative error over all primitives (fraction of the mesh extent). */
  error: number;
}

/**
 * Simplifies every triangle primitive in place to about `ratio` of its triangles. With
 * `lockBorder` off, region borders may move (tiny cracks), but split meshes reach their target.
 */
export function simplifyDocument(doc: Document, ratio: number, lockBorder = true): SimplifyResult {
  let error = 0;
  const seen = new Set<object>();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const tris = primitiveTriangles(prim);
      const position = prim.getAttribute('POSITION');
      const indices = prim.getIndices();
      if (tris < 8 || !position || !indices || seen.has(indices)) continue;
      seen.add(indices);
      const target = Math.max(3, Math.floor(tris * ratio) * 3);
      const positions = Float32Array.from(position.getArray() ?? []);
      const source = Uint32Array.from(indices.getArray() ?? []);
      const [result, primError] = MeshoptSimplifier.simplify(
        source,
        positions,
        3,
        target,
        MAX_SEARCH_ERROR,
        lockBorder ? ['LockBorder'] : [],
      );
      error = Math.max(error, primError);
      const out = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(result));
      prim.setIndices(out);
      compactPrimitive(prim);
    }
  }
  return { error };
}

const handMadeLod = (doc: Document): Map<string, Node> => {
  const map = new Map<string, Node>();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (name.endsWith(LOD1_SUFFIX) && node.getMesh()) {
      map.set(name.slice(0, -LOD1_SUFFIX.length), node);
    }
  }
  return map;
};

export const hasHandMadeLod = (doc: Document): boolean => handMadeLod(doc).size > 0;

/** LOD0 never ships the hand-made `*_LOD1` objects. */
export function stripHandMadeLod(doc: Document): void {
  for (const node of handMadeLod(doc).values()) node.dispose();
}

/** A copy where each `X_LOD1` object replaces `X` (and takes its name). */
export function useHandMadeLod(source: Document): Document {
  const doc = cloneDocument(source);
  const lods = handMadeLod(doc);
  for (const node of doc.getRoot().listNodes()) {
    const lod = lods.get(node.getName());
    if (lod && lod !== node) {
      node.setMesh(lod.getMesh());
      lod.dispose();
    }
  }
  return doc;
}

/** A simplified copy, plus its error. The source is left alone. */
export function simplifiedCopy(
  source: Document,
  ratio: number,
  lockBorder = true,
): { doc: Document } & SimplifyResult {
  const doc = cloneDocument(source);
  stripHandMadeLod(doc);
  return { doc, ...simplifyDocument(doc, ratio, lockBorder) };
}
