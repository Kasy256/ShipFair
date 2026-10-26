// Naming contract (docs/ART_PIPELINE.md): every problem is one plain sentence that names the file
// and the thing to fix, e.g. "booth_kit.glb: tier_booth has no SLOT_logo".
import type { Document, Node } from '@gltf-transform/core';
import type { WardrobeKind } from '@shipfair/shared';
import type { Contract } from './contract.ts';

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

const nodesNamed = (doc: Document, name: string): Node[] =>
  doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getName() === name);

const materialNames = (doc: Document): string[] =>
  doc
    .getRoot()
    .listMaterials()
    .map((m) => m.getName());

/** Joint names of the first skin, in joint order (skinIndex order). */
export const jointNames = (doc: Document): string[] =>
  doc
    .getRoot()
    .listSkins()[0]
    ?.listJoints()
    .map((j) => j.getName()) ?? [];

function missingAttributes(doc: Document, file: string, attributes: readonly string[]): string[] {
  const errors: string[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of attributes) {
        if (!prim.getAttribute(semantic)) {
          const material = prim.getMaterial()?.getName() ?? 'no material';
          errors.push(`${file}: mesh ${mesh.getName()} (${material}) has no ${semantic} attribute`);
        }
      }
    }
  }
  return errors;
}

export function checkCharacter(
  doc: Document,
  file: string,
  contract: Contract,
  entry: { hairs: readonly string[]; accessories: readonly string[] },
): CheckResult {
  const errors: string[] = [];
  const allowed = new Set(contract.materials.character);
  for (const name of materialNames(doc)) {
    if (!allowed.has(name)) {
      errors.push(
        `${file}: material "${name}" isn't one of ${contract.materials.character.join(', ')}`,
      );
    }
  }
  const skins = doc.getRoot().listSkins();
  if (skins.length !== 1) errors.push(`${file}: expected 1 armature (skin), found ${skins.length}`);
  for (const name of [...entry.hairs, ...entry.accessories]) {
    if (nodesNamed(doc, name).length === 0) errors.push(`${file}: no object named ${name}`);
  }
  const { region, mask } = contract.avatar.attributes;
  errors.push(...missingAttributes(doc, file, [region, mask]));
  return { errors, warnings: [] };
}

/**
 * Every required clip must exist. A missing clip with a declared substitute (that does exist) is
 * a warning, so a partly finished animation set still builds.
 */
export function checkAnimations(
  doc: Document,
  file: string,
  required: readonly string[],
  substitutes: Readonly<Record<string, string>>,
): CheckResult & { substitutes: Record<string, string> } {
  const names = new Set(
    doc
      .getRoot()
      .listAnimations()
      .map((a) => a.getName()),
  );
  const errors: string[] = [];
  const warnings: string[] = [];
  const used: Record<string, string> = {};
  for (const clip of required) {
    if (names.has(clip)) continue;
    const stand = substitutes[clip];
    if (stand && names.has(stand)) {
      warnings.push(`${file}: clip ${clip} is missing; playing ${stand} instead`);
      used[clip] = stand;
    } else if (stand) {
      errors.push(`${file}: clip ${clip} is missing and its substitute ${stand} is missing too`);
    } else {
      errors.push(`${file}: clip ${clip} is missing (rename the action to exactly "${clip}")`);
    }
  }
  if (doc.getRoot().listMeshes().length > 0) {
    warnings.push(`${file}: contains meshes; export the armature only`);
  }
  return { errors, warnings, substitutes: used };
}

export function checkBoothKit(
  doc: Document,
  file: string,
  contract: Contract,
  tiers: readonly string[],
): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { palette, accent, glow } = contract.materials;
  for (const name of materialNames(doc)) {
    if (name !== palette && name !== accent && name !== glow) {
      errors.push(`${file}: material "${name}" isn't ${palette}, ${accent} or ${glow}`);
    }
  }
  const parts = new Set(Object.keys(contract.boothKit.parts));
  for (const tier of tiers) {
    const [node, ...dupes] = nodesNamed(doc, tier);
    if (!node) {
      errors.push(`${file}: no ${tier} empty (each tier is a parent empty named exactly ${tier})`);
      continue;
    }
    if (dupes.length > 0) errors.push(`${file}: more than one node named ${tier}`);
    const children = node.listChildren();
    const childNames = new Set(children.map((c) => c.getName()));
    for (const slot of contract.boothKit.tierSlots[tier] ?? []) {
      if (!childNames.has(slot)) errors.push(`${file}: ${tier} has no ${slot}`);
    }
    for (const child of children) {
      const mesh = child.getMesh();
      if (!mesh) continue;
      const part = partName(child);
      if (!parts.has(part) && !parts.has(baseVariant(part, parts))) {
        warnings.push(`${file}: ${tier} uses unknown part ${part}`);
      }
    }
    if (!children.some((c) => c.getMesh())) errors.push(`${file}: ${tier} has no part meshes`);
  }
  return { errors, warnings };
}

/** The kit part a placement uses: `extras.part`, else the mesh name. */
export function partName(node: Node): string {
  const extras = node.getExtras() as { part?: unknown };
  return typeof extras.part === 'string' ? extras.part : (node.getMesh()?.getName() ?? '');
}

/** `kit_wall_back_workshop` -> `kit_wall_back` when that part exists (theme variants). */
export function baseVariant(part: string, parts: ReadonlySet<string>): string {
  for (const base of parts) if (part.startsWith(`${base}_`)) return base;
  return part;
}

export function checkWardrobeItem(
  doc: Document,
  file: string,
  contract: Contract,
  kind: WardrobeKind,
  bodyJoints: readonly string[],
): CheckResult {
  const { region, mask, uvPrint } = contract.avatar.attributes;
  const required = kind === 'top' ? [region, mask, uvPrint] : [region, mask];
  const errors = missingAttributes(doc, file, required);
  const joints = jointNames(doc);
  if (joints.length === 0) errors.push(`${file}: not skinned to the body armature`);
  else if (joints.join() !== bodyJoints.join()) {
    const differs = joints.findIndex((name, i) => name !== bodyJoints[i]);
    const at = differs === -1 ? Math.min(joints.length, bodyJoints.length) : differs;
    errors.push(
      `${file}: joints differ from the body skeleton (joint ${at}: ${joints[at] ?? 'none'} vs ${bodyJoints[at] ?? 'none'})`,
    );
  }
  return { errors, warnings: [] };
}
