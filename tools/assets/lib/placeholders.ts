// Generated stand-ins, written when an export is missing so the game always has something to load:
// a capsule character, a box booth kit with every tier and slot, box props and an empty clip set.
import { Document } from '@gltf-transform/core';
import type { ColliderShape } from '@shipfair/shared';
import type { Contract } from './contract.ts';
import { QUIET } from './io.ts';
import { type Attributes, box, lathe, primitive } from './shapes.ts';

const WHITE = [1, 1, 1, 1] as const;

function newDoc(): Document {
  const doc = new Document().setLogger(QUIET);
  doc.createBuffer();
  return doc;
}

const material = (doc: Document, name: string, color: readonly number[] = WHITE) =>
  doc
    .createMaterial(name)
    .setBaseColorFactor([...color] as [number, number, number, number])
    .setRoughnessFactor(0.8);

/** A 1.78 m capsule skinned to root → pelvis, split into SKIN / TOP / BOTTOM / SHOES. */
export function placeholderCharacter(contract: Contract): Document {
  const doc = newDoc();
  const scene = doc.createScene('Scene');
  const armature = doc.createNode('Armature');
  scene.addChild(armature);
  const root = doc.createNode('root');
  const pelvis = doc.createNode('pelvis').setTranslation([0, 0.95, 0]);
  root.addChild(pelvis);
  armature.addChild(root);
  const ibm = new Float32Array(32);
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.95, 0, 1], 16);
  const skin = doc
    .createSkin('Armature')
    .addJoint(root)
    .addJoint(pelvis)
    .setSkeleton(root)
    .setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm));
  const mesh = doc.createMesh('body');
  const regions = contract.avatar.regions;
  const bands: [string, number, (readonly [number, number])[]][] = [
    [
      'SHOES',
      regions.SHOES ?? 5,
      [
        [0.16, 0],
        [0.17, 0.12],
      ],
    ],
    [
      'BOTTOM',
      regions.BOTTOM ?? 3,
      [
        [0.17, 0.12],
        [0.2, 0.9],
      ],
    ],
    [
      'TOP',
      regions.TOP ?? 1,
      [
        [0.2, 0.9],
        [0.24, 1.25],
        [0.2, 1.45],
      ],
    ],
    [
      'SKIN',
      regions.SKIN ?? 0,
      [
        [0.08, 1.45],
        [0.13, 1.55],
        [0.13, 1.7],
        [0.05, 1.78],
      ],
    ],
  ];
  for (const [name, region, profile] of bands) {
    mesh.addPrimitive(
      primitive(doc, lathe(profile, 10), material(doc, name), {
        _REGION: { size: 1, value: [region] },
        _MASK: { size: 1, value: [0] },
        JOINTS_0: { size: 4, value: [1, 0, 0, 0] },
        WEIGHTS_0: { size: 4, value: [1, 0, 0, 0] },
      }),
    );
  }
  armature.addChild(doc.createNode('body').setMesh(mesh).setSkin(skin));
  return doc;
}

/** No clips: the engine poses characters procedurally until real clips exist. */
export function placeholderAnimations(): Document {
  const doc = newDoc();
  doc.createScene('Scene').addChild(doc.createNode('clips_skeleton'));
  return doc;
}

type V3 = [number, number, number];
interface PartShape {
  size: V3;
  centre: V3;
  material: 'palette' | 'accent' | 'glow';
}

/** Box sizes per kit part, local to the part's own origin (its base, front facing +Z). */
const PART_SHAPES: Record<string, PartShape> = {
  kit_floor: { size: [10, 0.18, 8], centre: [0, 0.09, 0], material: 'palette' },
  kit_wall_back: { size: [9.6, 3, 0.24], centre: [0, 1.5, 0], material: 'palette' },
  kit_wall_side: { size: [0.24, 2.6, 3.4], centre: [0, 1.3, 0], material: 'accent' },
  kit_counter: { size: [3, 1, 0.8], centre: [0, 0.5, 0], material: 'accent' },
  kit_screen: { size: [2.1, 1.26, 0.1], centre: [0, 0, 0], material: 'palette' },
  kit_sign: { size: [3.3, 0.7, 0.1], centre: [0, 0, 0], material: 'palette' },
  kit_ring: { size: [3, 0.08, 3], centre: [0, 0, 0], material: 'glow' },
  kit_roof: { size: [9.8, 0.2, 3], centre: [0, 0, 1.5], material: 'accent' },
  kit_stage: { size: [20, 0.5, 8], centre: [0, 0.25, 0], material: 'palette' },
};

type Placement = [part: string, at: V3, scale?: number];
type SlotSpec = [name: string, at: V3, w: number, h: number];

const STALL_PARTS: Placement[] = [
  ['kit_floor', [0, 0, 0]],
  ['kit_counter', [0, 0.18, 1.6]],
  ['kit_wall_back', [0, 0.18, -3.72]],
  ['kit_screen', [2.9, 1.93, -3.61]],
  ['kit_sign', [0, 2.78, -3.6]],
];
const SLOTS_1: SlotSpec[] = [
  ['SLOT_logo', [-2.9, 1.93, -3.55], 1.1, 1.1],
  ['SLOT_screen_0', [2.9, 1.93, -3.55], 1.92, 1.08],
  ['SLOT_sign', [0, 2.78, -3.54], 3.12, 0.52],
  ['SLOT_spawn', [0, 0.18, 3.3], 0, 0],
  ['SLOT_maker', [0, 0.18, 0.7], 0, 0],
];
const TIERS: Record<string, { lots: number; parts: Placement[]; slots: SlotSpec[] }> = {
  tier_stall: { lots: 1, parts: STALL_PARTS, slots: SLOTS_1 },
  tier_booth: {
    lots: 1,
    parts: [
      ...STALL_PARTS.filter(([p]) => p !== 'kit_screen'),
      ['kit_screen', [-2.9, 1.93, -3.61]],
      ['kit_screen', [2.9, 1.93, -3.61]],
      ['kit_ring', [0, 2.9, -1.2]],
      ['kit_roof', [0, 3.18, -3.8]],
      ['kit_wall_side', [-4.78, 0.18, -2.04]],
      ['kit_wall_side', [4.78, 0.18, -2.04]],
    ],
    slots: [
      ['SLOT_logo', [0, 1.73, -3.55], 1.1, 1.1],
      ['SLOT_screen_0', [-2.9, 1.93, -3.55], 1.92, 1.08],
      ['SLOT_screen_1', [2.9, 1.93, -3.55], 1.92, 1.08],
      ...SLOTS_1.slice(2),
    ],
  },
  tier_pavilion: {
    lots: 2,
    parts: [
      ['kit_stage', [0, 0, 0]],
      ['kit_counter', [-5.5, 0.5, 1.6]],
      ['kit_counter', [5.5, 0.5, 1.6]],
      ['kit_wall_back', [-4.9, 0.5, -3.72]],
      ['kit_wall_back', [4.9, 0.5, -3.72]],
      ['kit_screen', [-5, 2.13, -3.6], 1.3],
      ['kit_screen', [5, 2.13, -3.6], 1.3],
      ['kit_sign', [0, 2.7, -3.59], 1.3],
    ],
    slots: [
      ['SLOT_logo', [0, 1.48, -3.55], 1.4, 1.4],
      ['SLOT_screen_0', [-5, 2.13, -3.53], 2.5, 1.4],
      ['SLOT_screen_1', [5, 2.13, -3.53], 2.5, 1.4],
      ['SLOT_sign', [0, 2.7, -3.52], 4.06, 0.68],
      ['SLOT_spawn', [0, 0.5, 3.3], 0, 0],
      ['SLOT_maker', [0, 0.5, -2], 0, 0],
    ],
  },
};

/** Every contract part as a box, and every contract tier with its slots. */
export function placeholderBoothKit(contract: Contract): Document {
  const doc = newDoc();
  const scene = doc.createScene('Scene');
  const m = contract.materials;
  const materials = {
    palette: material(doc, m.palette, [0.85, 0.84, 0.81, 1]),
    accent: material(doc, m.accent),
    glow: material(doc, m.glow).setEmissiveFactor([1, 1, 1]),
  };
  const meshes = new Map<string, ReturnType<Document['createMesh']>>();
  for (const part of Object.keys(contract.boothKit.parts)) {
    const shape = PART_SHAPES[part] ?? {
      size: [1, 1, 1],
      centre: [0, 0.5, 0],
      material: 'palette',
    };
    const ao = { COLOR_0: { size: 3 as const, value: [1, 1, 1] } };
    const geometry: Attributes = box(shape.size, shape.centre);
    meshes.set(
      part,
      doc.createMesh(part).addPrimitive(primitive(doc, geometry, materials[shape.material], ao)),
    );
  }
  for (const id of contract.boothKit.tiers) {
    const spec = TIERS[id] ?? TIERS.tier_stall;
    if (!spec) continue;
    const lots = contract.boothKit.tierLots[id] ?? spec.lots;
    const tier = doc
      .createNode(id)
      .setExtras({ lots, widthM: contract.lot.widthM * lots, depthM: contract.lot.depthM });
    scene.addChild(tier);
    for (const [part, at, scale = 1] of spec.parts) {
      const mesh = meshes.get(part);
      if (!mesh) continue;
      tier.addChild(
        doc
          .createNode(part)
          .setMesh(mesh)
          .setTranslation(at)
          .setScale([scale, scale, scale])
          .setExtras({ part }),
      );
    }
    for (const slot of contract.boothKit.tierSlots[id] ?? []) {
      const [, at, w, h] = spec.slots.find(([name]) => name === slot) ?? [slot, [0, 1, 0], 0, 0];
      const isRect = w > 0;
      tier.addChild(
        doc
          .createNode(slot)
          .setTranslation(at)
          .setScale(isRect ? [w, h, 0.02] : [1, 1, 1])
          .setExtras(isRect ? { kind: 'rect', w, h } : { kind: 'point' }),
      );
    }
  }
  return doc;
}

/** A 0.8 m box (or an 8-sided column for cylinder colliders) on the palette material. */
export function placeholderProp(id: string, collider: ColliderShape, contract: Contract): Document {
  const doc = newDoc();
  const shape: Attributes =
    collider === 'cylinder'
      ? lathe(
          [
            [0.3, 0],
            [0.3, 1.6],
          ],
          8,
        )
      : box([0.8, 0.8, 0.8], [0, 0.4, 0]);
  const mesh = doc
    .createMesh(id)
    .addPrimitive(primitive(doc, shape, material(doc, contract.materials.palette)));
  doc.createScene('Scene').addChild(doc.createNode(id).setMesh(mesh));
  return doc;
}
