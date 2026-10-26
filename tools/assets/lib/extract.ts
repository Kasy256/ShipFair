// Data the engine needs without parsing node hierarchies at runtime: booth tier placements and
// slot transforms, clip durations, bounds and the pelvis rest height.
import type { Document, Node } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import type { Bounds, BuiltBoothKit, BuiltTier } from '@shipfair/shared';
import { partName } from './checks.ts';
import { meshTriangles } from './stats.ts';

const round = (v: number) => Math.round(v * 1e5) / 1e5;
const roundAll = (values: ArrayLike<number>) => Array.from(values, round);

export function bounds(doc: Document): Bounds {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return { min: [0, 0, 0], max: [0, 0, 0] };
  const { min, max } = getBounds(scene);
  const ok = min.every(Number.isFinite) && max.every(Number.isFinite);
  return ok
    ? {
        min: [round(min[0]), round(min[1]), round(min[2])],
        max: [round(max[0]), round(max[1]), round(max[2])],
      }
    : { min: [0, 0, 0], max: [0, 0, 0] };
}

const numberExtra = (node: Node, key: string): number | undefined => {
  const value = (node.getExtras() as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
};

function tierOf(node: Node): BuiltTier {
  const parts: BuiltTier['parts'] = [];
  const slots: BuiltTier['slots'] = [];
  for (const child of node.listChildren()) {
    const name = child.getName();
    const matrix = roundAll(child.getMatrix());
    if (name.startsWith('SLOT_')) {
      const [sx, sy] = child.getScale();
      const isRect = (child.getExtras() as { kind?: unknown }).kind === 'rect';
      slots.push({
        name,
        matrix,
        w: round(numberExtra(child, 'w') ?? (isRect ? sx : 0)),
        h: round(numberExtra(child, 'h') ?? (isRect ? sy : 0)),
      });
    } else if (child.getMesh()) {
      parts.push({ part: partName(child), matrix });
    }
  }
  return {
    id: node.getName(),
    lots: numberExtra(node, 'lots') ?? 1,
    widthM: numberExtra(node, 'widthM') ?? 10,
    depthM: numberExtra(node, 'depthM') ?? 8,
    parts,
    slots,
  };
}

/** Tier placements, part list and AO attribute name, read from the kit's node hierarchy. */
export function boothKitLayout(
  doc: Document,
  tierIds: readonly string[],
): Pick<BuiltBoothKit, 'parts' | 'tiers' | 'aoAttribute'> {
  const nodes = doc.getRoot().listNodes();
  const tiers = tierIds.flatMap((id) => {
    const node = nodes.find((n) => n.getName() === id);
    return node ? [tierOf(node)] : [];
  });
  const meshes = doc.getRoot().listMeshes();
  const parts = meshes.map((m) => ({ name: m.getName(), triangles: meshTriangles(m) }));
  const prims = meshes.flatMap((m) => m.listPrimitives());
  const aoAttribute = prims.some((p) => p.getAttribute('_AO'))
    ? '_AO'
    : prims.some((p) => p.getAttribute('COLOR_0'))
      ? 'COLOR_0'
      : null;
  return { parts, tiers, aoAttribute };
}

export function clipList(doc: Document): { name: string; durationS: number }[] {
  return doc
    .getRoot()
    .listAnimations()
    .map((a) => ({
      name: a.getName(),
      durationS: round(
        Math.max(0, ...a.listSamplers().map((s) => s.getInput()?.getMax([0])[0] ?? 0)),
      ),
    }));
}

/** `pelvisRestHeightM` from the clip skeleton's extras (04a writes it), or null. */
export function pelvisRestHeight(doc: Document): number | null {
  for (const node of doc.getRoot().listNodes()) {
    const value = numberExtra(node, 'pelvisRestHeightM');
    if (value !== undefined) return value;
  }
  return null;
}

/** World-space rest height of the `pelvis` joint (falls back to the bounds' mid height). */
export function hipHeight(doc: Document): number {
  const pelvis = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === 'pelvis');
  if (pelvis) return round(pelvis.getWorldMatrix()[13]);
  const { min, max } = bounds(doc);
  return round((min[1] + max[1]) / 2);
}
