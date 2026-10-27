import type { BuiltTier } from '@shipfair/shared';
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { LoadedAsset } from '../assets/asset-manager.ts';

// The last resort when neither booth_kit.glb nor the build's generated placeholder can load
// (e.g. no manifest at all): plain boxes with the same tiers and slots as the contract.

type V3 = readonly [number, number, number];
const PARTS: Readonly<Record<string, { size: V3; centre: V3; material: string }>> = {
  kit_floor: { size: [10, 0.18, 8], centre: [0, 0.09, 0], material: 'PALETTE' },
  kit_wall_back: { size: [9.6, 3, 0.24], centre: [0, 1.5, 0], material: 'PALETTE' },
  kit_counter: { size: [3, 1, 0.8], centre: [0, 0.5, 0], material: 'ACCENT' },
  kit_sign: { size: [3.3, 0.7, 0.1], centre: [0, 0, 0], material: 'GLOW' },
  kit_stage: { size: [20, 0.5, 8], centre: [0, 0.25, 0], material: 'PALETTE' },
};

const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(sx, sy, sz)).toArray();

const slots = (y: number, scale: number): BuiltTier['slots'] => [
  {
    name: 'SLOT_logo',
    matrix: at(-2.9, y + 1.75, -3.55, 1.1 * scale, 1.1 * scale, 0.02),
    w: 1.1 * scale,
    h: 1.1 * scale,
  },
  { name: 'SLOT_screen_0', matrix: at(2.9, y + 1.75, -3.55, 1.92, 1.08, 0.02), w: 1.92, h: 1.08 },
  { name: 'SLOT_screen_1', matrix: at(0, y + 1.75, -3.55, 1.92, 1.08, 0.02), w: 1.92, h: 1.08 },
  { name: 'SLOT_sign', matrix: at(0, y + 2.6, -3.54, 3.12, 0.52, 0.02), w: 3.12, h: 0.52 },
  { name: 'SLOT_spawn', matrix: at(0, y, 3.3), w: 0, h: 0 },
  { name: 'SLOT_maker', matrix: at(0, y, 0.7), w: 0, h: 0 },
];

const oneLot = (id: string): BuiltTier => ({
  id,
  lots: 1,
  widthM: 10,
  depthM: 8,
  parts: [
    { part: 'kit_floor', matrix: at(0, 0, 0) },
    { part: 'kit_counter', matrix: at(0, 0.18, 1.6) },
    { part: 'kit_wall_back', matrix: at(0, 0.18, -3.72) },
    { part: 'kit_sign', matrix: at(0, 2.78, -3.6) },
  ],
  slots: slots(0.18, 1),
});

export const FALLBACK_TIERS: readonly BuiltTier[] = [
  oneLot('tier_stall'),
  oneLot('tier_booth'),
  {
    id: 'tier_pavilion',
    lots: 2,
    widthM: 20,
    depthM: 8,
    parts: [
      { part: 'kit_stage', matrix: at(0, 0, 0) },
      { part: 'kit_wall_back', matrix: at(-4.9, 0.5, -3.72) },
      { part: 'kit_wall_back', matrix: at(4.9, 0.5, -3.72) },
      { part: 'kit_sign', matrix: at(0, 2.9, -3.6, 1.3, 1.3, 1.3) },
    ],
    slots: slots(0.5, 1.3),
  },
];

/** A scene shaped like a loaded booth_kit.glb: one node per part with `userData.part`. */
export function fallbackKitAsset(): LoadedAsset {
  const scene = new Group();
  for (const [part, spec] of Object.entries(PARTS)) {
    const geometry = new BoxGeometry(...spec.size).translate(...spec.centre);
    const material = new MeshBasicMaterial();
    material.name = spec.material;
    const mesh = new Mesh(geometry, material);
    mesh.userData.part = part;
    scene.add(mesh);
  }
  return { scene, animations: [], isPlaceholder: true };
}
