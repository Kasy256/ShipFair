// LOD1 by meshoptimizer's simplifier. Simplification only re-indexes existing vertices, so skin
// weights, `_REGION` and `_MASK` carry over untouched.
import type { Document, Mesh, Node, Primitive } from '@gltf-transform/core';
import { cloneDocument, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { primitiveTriangles } from './stats.ts';

/** Largest relative error the simplifier may accept while chasing the triangle target. */
const MAX_SEARCH_ERROR = 0.1;
export const LOD1_SUFFIX = '_LOD1';

/** A locked-border result this far above its target counts as stalled and is redone unlocked. */
const STALL_RATIO = 1.25;

export interface SimplifyResult {
  /**
   * Worst geometric error, as a fraction of `referenceSizeM` (by default the largest mesh in the
   * document, i.e. the character): 0.02 means 2% of the character's size, whatever the mesh.
   */
  error: number;
}

interface MeshInput {
  mesh: Mesh;
  prims: Primitive[];
  positions: Float32Array;
  indices: Uint32Array;
  starts: number[];
  scale: number;
}

function gather(doc: Document): MeshInput[] {
  const out: MeshInput[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const prims = mesh
      .listPrimitives()
      .filter((p) => primitiveTriangles(p) >= 8 && p.getAttribute('POSITION') && p.getIndices());
    if (prims.length === 0) continue;
    const positions: number[] = [];
    const indices: number[] = [];
    const starts: number[] = [];
    for (const prim of prims) {
      const base = positions.length / 3;
      starts.push(base);
      positions.push(...(prim.getAttribute('POSITION')?.getArray() ?? []));
      for (const i of prim.getIndices()?.getArray() ?? []) indices.push(i + base);
    }
    starts.push(positions.length / 3);
    const p = Float32Array.from(positions);
    out.push({
      mesh,
      prims,
      positions: p,
      indices: Uint32Array.from(indices),
      starts,
      scale: MeshoptSimplifier.getScale(p, 3),
    });
  }
  return out;
}

/**
 * Simplifies every triangle mesh in place to about `ratio` of its triangles.
 *
 * All primitives of a mesh are simplified together, as one index buffer over their concatenated
 * vertices: where two material regions meet, meshoptimizer sees co-located vertices as a seam
 * that collapses on both sides at once, instead of two open borders that must stay locked.
 * (Simplifying the body's four regions one by one stalled above budget, or cracked with error
 * 0.046; jointly it is 0.002.) Open borders (hems, hair edges) are locked, unless locking stalls
 * a mesh far above its target; then that mesh alone is redone unlocked.
 */
export function simplifyDocument(
  doc: Document,
  ratio: number,
  referenceSizeM?: number,
): SimplifyResult {
  const meshes = gather(doc);
  const reference = referenceSizeM ?? Math.max(1e-6, ...meshes.map((m) => m.scale));
  let error = 0;
  for (const { mesh, prims, positions, indices, starts, scale } of meshes) {
    const target = Math.max(3, Math.floor((indices.length / 3) * ratio) * 3);
    const run = (flags: 'LockBorder'[]) =>
      MeshoptSimplifier.simplify(indices, positions, 3, target, MAX_SEARCH_ERROR, flags);
    let [result, meshError] = run(['LockBorder']);
    if (result.length > target * STALL_RATIO) [result, meshError] = run([]);
    error = Math.max(error, (meshError * scale) / reference);
    // Hand each kept triangle back to the primitive its vertices belong to.
    const owner = (v: number) => starts.findIndex((s, k) => v >= s && v < (starts[k + 1] ?? 0));
    const perPrim: number[][] = prims.map(() => []);
    for (let t = 0; t < result.length; t += 3) {
      const a = result[t] ?? 0;
      const k = owner(a);
      // Seam collapses keep each side's own vertices; a triangle spanning two would be a bug.
      if (k < 0 || owner(result[t + 1] ?? 0) !== k || owner(result[t + 2] ?? 0) !== k) continue;
      const base = starts[k] ?? 0;
      perPrim[k]?.push(a - base, (result[t + 1] ?? 0) - base, (result[t + 2] ?? 0) - base);
    }
    prims.forEach((prim, k) => {
      const kept = perPrim[k] ?? [];
      // glTF accessors can't be empty: a region simplified away entirely is dropped.
      if (kept.length === 0) {
        mesh.removePrimitive(prim);
        return;
      }
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(kept)));
      compactPrimitive(prim);
    });
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

/** A simplified copy, plus its error (see `simplifyDocument`). The source is left alone. */
export function simplifiedCopy(
  source: Document,
  ratio: number,
  referenceSizeM?: number,
): { doc: Document } & SimplifyResult {
  const doc = cloneDocument(source);
  stripHandMadeLod(doc);
  return { doc, ...simplifyDocument(doc, ratio, referenceSizeM) };
}
