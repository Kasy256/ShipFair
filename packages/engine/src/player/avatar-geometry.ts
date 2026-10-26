import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';

/** Geometry for one procedural rig. Shared by every avatar instance and refcounted. */
export interface RigGeometry {
  pelvis: BufferGeometry;
  torso: BufferGeometry;
  hood: BufferGeometry;
  pack: BufferGeometry;
  head: BufferGeometry;
  hair: BufferGeometry;
  eye: BufferGeometry;
  upperArm: BufferGeometry;
  foreArm: BufferGeometry;
  hand: BufferGeometry;
  thigh: BufferGeometry;
  shin: BufferGeometry;
  foot: BufferGeometry;
  sole: BufferGeometry;
}

/** A capsule hanging down from its joint, as in the prototype's `limb()`. */
function limb(radius: number, length: number): BufferGeometry {
  const g = new CapsuleGeometry(radius, length, 4, 8);
  g.translate(0, -length / 2 - radius * 0.6, 0);
  return g;
}

function build(): RigGeometry {
  return {
    pelvis: new CapsuleGeometry(0.15, 0.08, 4, 10),
    torso: new CapsuleGeometry(0.18, 0.32, 4, 12),
    hood: new TorusGeometry(0.12, 0.05, 6, 12),
    pack: new BoxGeometry(0.3, 0.38, 0.14),
    head: new SphereGeometry(0.115, 16, 12),
    hair: new SphereGeometry(0.122, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    eye: new SphereGeometry(0.014, 6, 4),
    upperArm: limb(0.055, 0.2),
    foreArm: limb(0.048, 0.18),
    hand: new SphereGeometry(0.05, 8, 6),
    thigh: limb(0.075, 0.3),
    shin: limb(0.062, 0.3),
    foot: new BoxGeometry(0.11, 0.08, 0.25),
    sole: new BoxGeometry(0.115, 0.02, 0.26),
  };
}

let shared: RigGeometry | undefined;
let users = 0;

export function acquireRigGeometry(): RigGeometry {
  shared ??= build();
  users++;
  return shared;
}

/** Disposes the shared geometry when the last avatar lets go of it. */
export function releaseRigGeometry(): void {
  users = Math.max(0, users - 1);
  if (users > 0 || !shared) return;
  for (const geometry of Object.values(shared)) geometry.dispose();
  shared = undefined;
}
