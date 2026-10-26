import type { Document, Mesh, Primitive } from '@gltf-transform/core';
import type { AssetStats } from '@shipfair/shared';
import type { Budget } from './contract.ts';

const TRIANGLES = 4;

export function primitiveTriangles(prim: Primitive): number {
  if (prim.getMode() !== TRIANGLES) return 0;
  const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0;
  return Math.floor(count / 3);
}

export const meshTriangles = (mesh: Mesh): number =>
  mesh.listPrimitives().reduce((sum, p) => sum + primitiveTriangles(p), 0);

/**
 * Triangles a player can actually see at once. Objects in `alternatives` (hairstyles in a body
 * file) are mutually exclusive, so only the largest one counts. Everything else counts in full.
 */
export function countTriangles(doc: Document, alternatives: readonly string[] = []): number {
  const alt = new Set(alternatives);
  let total = 0;
  let largestAlt = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const tris = meshTriangles(mesh);
    if (alt.has(node.getName())) largestAlt = Math.max(largestAlt, tris);
    else total += tris;
  }
  return total + largestAlt;
}

export function measure(
  doc: Document,
  bytes: number,
  alternatives: readonly string[] = [],
): Omit<AssetStats, 'isOverBudget' | 'problems'> {
  const root = doc.getRoot();
  return {
    triangles: countTriangles(doc, alternatives),
    materials: root.listMaterials().length,
    bytes,
    bones: Math.max(0, ...root.listSkins().map((s) => s.listJoints().length)),
  };
}

/** Compares measured numbers with a contract budget. Each excess is one problem line. */
export function checkBudget(
  label: string,
  stats: Omit<AssetStats, 'isOverBudget' | 'problems'>,
  budget: Budget,
): AssetStats {
  const problems: string[] = [];
  const over = (what: string, value: number, limit: number | undefined, unit = '') => {
    if (limit !== undefined && value > limit) {
      problems.push(`${label}: ${what} ${value}${unit} is over the budget of ${limit}${unit}`);
    }
  };
  over('triangles', stats.triangles, budget.triangles);
  over('materials', stats.materials, budget.materials);
  over('file size', Math.ceil(stats.bytes / 1024), budget.fileKB, ' KB');
  over('deform bones', stats.bones, budget.deformBones);
  return { ...stats, isOverBudget: problems.length > 0, problems };
}

/** Triangles of the largest object among `alternatives` (0 if none of them exist). */
export function largestAlternative(doc: Document, alternatives: readonly string[]): number {
  const alt = new Set(alternatives);
  let largest = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh && alt.has(node.getName())) largest = Math.max(largest, meshTriangles(mesh));
  }
  return largest;
}
