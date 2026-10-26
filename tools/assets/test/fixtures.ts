// Tiny glTF documents built in memory, so the checks run against real node/material/attribute
// structures without committing binary fixtures.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document } from '@gltf-transform/core';
import { Contract } from '../lib/contract.ts';
import { QUIET } from '../lib/io.ts';
import { box, primitive } from '../lib/shapes.ts';

export const contract = Contract.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../art/contract.json'), 'utf8')),
);

export const newDoc = () => {
  const doc = new Document().setLogger(QUIET);
  doc.createBuffer();
  doc.createScene('Scene');
  return doc;
};

const scene = (doc: Document) => doc.getRoot().listScenes()[0] ?? doc.createScene();

/** A skinned box per material, with `_REGION`/`_MASK` unless `omit` lists them. */
export function character(
  materials: readonly string[],
  opts: {
    joints?: readonly string[];
    omit?: readonly string[];
    extraNodes?: readonly string[];
  } = {},
): Document {
  const doc = newDoc();
  const joints = (opts.joints ?? ['root', 'pelvis']).map((name) => doc.createNode(name));
  for (let i = 1; i < joints.length; i++) joints[i - 1]?.addChild(joints[i] as never);
  const skin = doc.createSkin();
  for (const j of joints) skin.addJoint(j);
  const mesh = doc.createMesh('body');
  const omit = new Set(opts.omit ?? []);
  const extra: Record<string, { size: 1 | 4; value: number[] }> = {
    JOINTS_0: { size: 4, value: [0, 0, 0, 0] },
    WEIGHTS_0: { size: 4, value: [1, 0, 0, 0] },
  };
  for (const name of ['_REGION', '_MASK', '_UV_PRINT'])
    if (!omit.has(name)) extra[name] = { size: 1, value: [0] };
  for (const m of materials)
    mesh.addPrimitive(primitive(doc, box([1, 1, 1]), doc.createMaterial(m), extra));
  const root = joints[0];
  if (root) scene(doc).addChild(root);
  scene(doc).addChild(doc.createNode('body').setMesh(mesh).setSkin(skin));
  for (const name of opts.extraNodes ?? []) {
    const hair = doc
      .createMesh(name)
      .addPrimitive(primitive(doc, box([0.2, 0.2, 0.2]), doc.createMaterial('HAIR'), extra));
    scene(doc).addChild(doc.createNode(name).setMesh(hair).setSkin(skin));
  }
  return doc;
}

/** Animations named `clips`, each one rotation channel on a `root` node. */
export function clips(names: readonly string[]): Document {
  const doc = newDoc();
  const node = doc.createNode('root');
  scene(doc).addChild(node);
  for (const name of names) {
    const input = doc
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Float32Array([0, 1.5]));
    const output = doc
      .createAccessor()
      .setType('VEC4')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]));
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output);
    const channel = doc
      .createAnimationChannel()
      .setTargetNode(node)
      .setTargetPath('rotation')
      .setSampler(sampler);
    doc.createAnimation(name).addSampler(sampler).addChannel(channel);
  }
  return doc;
}

/** A booth kit with `tiers`, each holding one floor part and the slots in `slots`. */
export function boothKit(tiers: Readonly<Record<string, readonly string[]>>): Document {
  const doc = newDoc();
  const floor = doc
    .createMesh('kit_floor')
    .addPrimitive(primitive(doc, box([10, 0.2, 8]), doc.createMaterial('PALETTE')));
  for (const [tier, slots] of Object.entries(tiers)) {
    const node = doc.createNode(tier).setExtras({ lots: 1, widthM: 10, depthM: 8 });
    node.addChild(doc.createNode('kit_floor').setMesh(floor).setExtras({ part: 'kit_floor' }));
    for (const slot of slots) {
      node.addChild(
        doc
          .createNode(slot)
          .setTranslation([1, 2, -3])
          .setScale([1.1, 1.1, 0.02])
          .setExtras({ kind: 'rect', w: 1.1, h: 1.1 }),
      );
    }
    scene(doc).addChild(node);
  }
  return doc;
}
