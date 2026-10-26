import {
  type AvatarStyleV2,
  HAIR_HEX,
  isHairVisible,
  PALETTE_HEX,
  SKIN_HEX,
} from '@shipfair/shared';
import { Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import {
  advancePose,
  createPose,
  createPoseState,
  HIPS_HEIGHT_M,
  type Locomotion,
  startLand,
  startWave,
} from '../avatars/pose.ts';
import { LAND_MIN_AIRTIME_S } from '../config.ts';
import { acquireRigGeometry, releaseRigGeometry } from './avatar-geometry.ts';

/** Emote ids carried by the `emote` bus event. Prompt 12 fills in the rest of the set. */
export const EMOTE_WAVE = 0;

/**
 * What the engine needs from any avatar. The procedural rig below is the placeholder; prompt
 * 04b swaps in glTF characters behind this same interface and keeps this one as the fallback
 * and far-distance stand-in.
 */
export interface AvatarView {
  readonly object: Object3D;
  /** Sits just above the head. A name tag attaches here (prompt 11). */
  readonly nameTagAnchor: Object3D;
  setStyle(style: AvatarStyleV2): void;
  setLocomotion(speed: number, isGrounded: boolean, vy: number): void;
  playEmote(emote: number): void;
  /** Advances animation. `time` is loop time. Returns true on a footstep. */
  update(dt: number, time: number): boolean;
  dispose(): void;
}

interface Limb {
  shoulder: Group;
  elbow: Group;
}

interface Leg {
  hip: Group;
  knee: Group;
}

const hex = (list: readonly string[], i: number) => list[i] ?? list[0] ?? '#ff00ff';

/** Low-poly human ported from the prototype's `Player.build`, coloured from `AvatarStyle`. */
export class ProceduralAvatar implements AvatarView {
  readonly object = new Group();
  readonly nameTagAnchor = new Group();
  readonly #materials = {
    skin: new MeshStandardMaterial({ roughness: 0.6 }),
    top: new MeshStandardMaterial({ roughness: 0.9 }),
    trim: new MeshStandardMaterial({ roughness: 0.9 }),
    bottom: new MeshStandardMaterial({ roughness: 0.8 }),
    shoes: new MeshStandardMaterial({ roughness: 0.5 }),
    sole: new MeshStandardMaterial({ roughness: 0.6 }),
    hair: new MeshStandardMaterial({ roughness: 1 }),
    eyes: new MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }),
    pack: new MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.7 }),
  };
  readonly #hips = new Group();
  readonly #chest = new Group();
  readonly #arms: [Limb, Limb];
  readonly #legs: [Leg, Leg];
  readonly #hair: Mesh;
  readonly #pack: Mesh;
  readonly #pose = createPose();
  readonly #state = createPoseState();
  readonly #motion: Locomotion = { speed: 0, isGrounded: true, vy: 0 };
  #airTime = 0;

  constructor(style: AvatarStyleV2) {
    const g = acquireRigGeometry();
    const m = this.#materials;
    const mesh = (geometry: Mesh['geometry'], material: MeshStandardMaterial, parent: Object3D) => {
      const out = new Mesh(geometry, material);
      out.castShadow = true;
      parent.add(out);
      return out;
    };

    this.object.name = 'avatar';
    this.#hips.position.y = HIPS_HEIGHT_M;
    this.object.add(this.#hips);
    mesh(g.pelvis, m.bottom, this.#hips).scale.set(1.25, 1, 0.8);
    this.#chest.position.y = 0.1;
    this.#hips.add(this.#chest);
    const torso = mesh(g.torso, m.top, this.#chest);
    torso.scale.set(1.2, 1, 0.75);
    torso.position.y = 0.22;
    const hood = mesh(g.hood, m.trim, this.#chest);
    hood.rotation.x = Math.PI / 2;
    hood.position.set(0, 0.5, -0.04);
    this.#pack = mesh(g.pack, m.pack, this.#chest);
    this.#pack.position.set(0, 0.26, -0.2);

    const neck = new Group();
    neck.position.y = 0.52;
    this.#chest.add(neck);
    const head = mesh(g.head, m.skin, neck);
    head.scale.set(1, 1.12, 1.04);
    head.position.y = 0.14;
    this.#hair = mesh(g.hair, m.hair, neck);
    this.#hair.position.y = 0.17;
    this.#hair.scale.set(1, 0.9, 1.05);
    for (const side of [-1, 1]) {
      const eye = mesh(g.eye, m.eyes, neck);
      eye.castShadow = false;
      eye.position.set(side * 0.04, 0.16, 0.105);
    }
    this.nameTagAnchor.position.y = 0.42;
    neck.add(this.nameTagAnchor);

    const arm = (side: number): Limb => {
      const shoulder = new Group();
      shoulder.position.set(side * 0.235, 0.44, 0);
      this.#chest.add(shoulder);
      mesh(g.upperArm, m.top, shoulder);
      const elbow = new Group();
      elbow.position.y = -0.31;
      shoulder.add(elbow);
      mesh(g.foreArm, m.top, elbow);
      const hand = mesh(g.hand, m.skin, elbow);
      hand.position.y = -0.3;
      hand.scale.set(0.9, 1.2, 0.7);
      return { shoulder, elbow };
    };
    const leg = (side: number): Leg => {
      const hip = new Group();
      hip.position.set(side * 0.1, -0.02, 0);
      this.#hips.add(hip);
      mesh(g.thigh, m.bottom, hip);
      const knee = new Group();
      knee.position.y = -0.44;
      hip.add(knee);
      mesh(g.shin, m.bottom, knee);
      mesh(g.foot, m.shoes, knee).position.set(0, -0.45, 0.05);
      mesh(g.sole, m.sole, knee).position.set(0, -0.495, 0.05);
      return { hip, knee };
    };
    this.#arms = [arm(1), arm(-1)];
    this.#legs = [leg(1), leg(-1)];
    this.setStyle(style);
    this.update(0, 0);
  }

  setStyle(style: AvatarStyleV2): void {
    const m = this.#materials;
    m.skin.color.set(hex(SKIN_HEX, style.skin));
    m.top.color.set(hex(PALETTE_HEX, style.top.color));
    m.trim.color.set(hex(PALETTE_HEX, style.top.color2));
    m.bottom.color.set(hex(PALETTE_HEX, style.bottom.color));
    m.shoes.color.set(hex(PALETTE_HEX, style.shoes.color));
    m.sole.color.set(hex(PALETTE_HEX, style.shoes.color2));
    m.hair.color.set(hex(HAIR_HEX, style.hair.color));
    this.#hair.visible = isHairVisible(style) && style.hair.item !== 'bald';
    this.#pack.visible = style.accessory.item === 'backpack';
  }

  setLocomotion(speed: number, isGrounded: boolean, vy: number): void {
    const motion = this.#motion;
    if (isGrounded && !motion.isGrounded && this.#airTime >= LAND_MIN_AIRTIME_S) {
      startLand(this.#state);
    }
    motion.speed = speed;
    motion.isGrounded = isGrounded;
    motion.vy = vy;
  }

  playEmote(emote: number): void {
    if (emote === EMOTE_WAVE) startWave(this.#state);
  }

  update(dt: number, time: number): boolean {
    this.#airTime = this.#motion.isGrounded ? 0 : this.#airTime + dt;
    const p = this.#pose;
    const hasStepped = advancePose(this.#state, this.#motion, dt, time, p);
    const [a0, a1] = this.#arms;
    const [l0, l1] = this.#legs;
    this.#hips.position.y = p.hipsY;
    this.#chest.rotation.x = p.chestLean;
    this.#chest.scale.y = p.chestScaleY;
    l0.hip.rotation.x = p.hip0;
    l1.hip.rotation.x = p.hip1;
    l0.knee.rotation.x = p.knee0;
    l1.knee.rotation.x = p.knee1;
    a0.shoulder.rotation.set(p.shoulderX0, 0, p.shoulderZ0);
    a1.shoulder.rotation.set(p.shoulderX1, 0, p.shoulderZ1);
    a0.elbow.rotation.set(p.elbowX0, 0, p.elbowZ0);
    a1.elbow.rotation.set(p.elbowX1, 0, 0);
    return hasStepped;
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const material of Object.values(this.#materials)) material.dispose();
    releaseRigGeometry();
  }
}
