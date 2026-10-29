import type RAPIER from '@dimforge/rapier3d-compat';
import { type CityLayout, type Rect, rng } from '@shipfair/shared';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { TREE_BELT_M, TREE_COUNT } from '../config.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import { InstanceBatch } from '../render/instance-batch.ts';
import { PLAZA_PLANTERS } from './plaza.ts';

// Instanced trees (trunk + crown, the prototype's stylised umbrella trees) in a belt round the
// city, and planters with a bush on the plaza. Seeded, so every client grows the same forest.

const SEED = 2026;
const TRUNK_RADIUS_M = 0.3;
const PLANTER_M = 1.6;
const PLANTER_H_M = 0.8;
/** Trees closer than this to a district or the plaza are pruned (e.g. after a district grows). */
const CLEARANCE_M = 3;
const up = new Vector3(0, 1, 0);

interface Tree {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly collider: RAPIER.Collider;
}

const inside = (r: Rect, x: number, z: number, pad: number) =>
  x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;

export class Greenery {
  readonly root = new Group();
  readonly #physics: PhysicsWorld;
  readonly #geometries = [
    new CylinderGeometry(0.18, TRUNK_RADIUS_M, 1, 6).translate(0, 0.5, 0),
    new IcosahedronGeometry(1, 1),
    new BoxGeometry(PLANTER_M, PLANTER_H_M, PLANTER_M).translate(0, PLANTER_H_M / 2, 0),
  ] as const;
  readonly #materials = [
    new MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 }),
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
    new MeshStandardMaterial({ color: 0x40444c, roughness: 0.8 }),
  ] as const;
  readonly trunks: InstanceBatch;
  readonly crowns: InstanceBatch;
  readonly planters: InstanceBatch;
  readonly bushes: InstanceBatch;
  #trees: Tree[] = [];
  readonly #colliders: RAPIER.Collider[] = [];

  constructor(layout: CityLayout, physics: PhysicsWorld) {
    this.root.name = 'greenery';
    this.#physics = physics;
    const [trunk, crown, planter] = this.#geometries;
    const [bark, leaves, stone] = this.#materials;
    const opts = { castShadow: true, receiveShadow: true, capacity: TREE_COUNT };
    this.trunks = new InstanceBatch(this.root, trunk, bark, { ...opts, name: 'tree-trunks' });
    this.crowns = new InstanceBatch(this.root, crown, leaves, {
      ...opts,
      name: 'tree-crowns',
      hasColor: true,
    });
    const small = { castShadow: true, receiveShadow: true, capacity: PLAZA_PLANTERS.length };
    this.planters = new InstanceBatch(this.root, planter, stone, { ...small, name: 'planters' });
    this.bushes = new InstanceBatch(this.root, crown, leaves, {
      ...small,
      name: 'bushes',
      hasColor: true,
    });
    this.#plant(layout);
  }

  /** Removes trees that a grown district now covers. */
  prune(layout: CityLayout): void {
    this.#trees = this.#trees.filter((tree) => {
      const isBlocked = layout.districts.some((d) => inside(d.rect, tree.x, tree.z, CLEARANCE_M));
      if (!isBlocked) return true;
      this.trunks.remove(tree.key);
      this.crowns.remove(tree.key);
      if (this.#physics.isAlive) this.#physics.world.removeCollider(tree.collider, false);
      return false;
    });
  }

  get treeCount(): number {
    return this.#trees.length;
  }

  cull(x: number, z: number, radius: number): void {
    for (const batch of [this.trunks, this.crowns, this.planters, this.bushes]) {
      batch.cull(x, z, radius);
    }
  }

  dispose(): void {
    if (this.#physics.isAlive) {
      for (const c of [...this.#trees.map((t) => t.collider), ...this.#colliders]) {
        this.#physics.world.removeCollider(c, false);
      }
    }
    for (const batch of [this.trunks, this.crowns, this.planters, this.bushes]) batch.dispose();
    for (const g of this.#geometries) g.dispose();
    for (const m of this.#materials) m.dispose();
    this.root.removeFromParent();
  }

  #plant(layout: CityLayout): void {
    const random = rng(SEED);
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    const green = new Color();
    const b = layout.bounds;
    const [near, far] = TREE_BELT_M;
    const outer = {
      minX: b.minX - far,
      maxX: b.maxX + far,
      minZ: b.minZ - far,
      maxZ: b.maxZ + far,
    };
    let attempts = 0;
    while (this.#trees.length < TREE_COUNT && attempts++ < TREE_COUNT * 20) {
      const x = outer.minX + random() * (outer.maxX - outer.minX);
      const z = outer.minZ + random() * (outer.maxZ - outer.minZ);
      const h = 3 + random() * 2.5;
      const yaw = random() * Math.PI * 2;
      const spread = 2.8 + random() * 1.5;
      const shade = random();
      if (inside(b, x, z, near)) continue;
      const key = `tree-${this.#trees.length}`;
      this.trunks.set(key, m.compose(p.set(x, 0, z), q.identity(), s.set(1, h, 1)), x, z);
      q.setFromAxisAngle(up, yaw);
      m.compose(p.set(x, h + 0.4, z), q, s.set(spread, 0.9 + shade * 0.4, spread));
      this.crowns.set(key, m, x, z, green.setHSL(0.27 + shade * 0.06, 0.38, 0.32 + shade * 0.08));
      const collider = this.#physics.addCylinder({ x, y: h / 2, z }, h / 2, TRUNK_RADIUS_M);
      this.#trees.push({ key, x, z, collider });
    }
    PLAZA_PLANTERS.forEach(([x, z], i) => {
      const key = `planter-${i}`;
      this.planters.set(key, m.compose(p.set(x, 0, z), q.identity(), s.set(1, 1, 1)), x, z);
      m.compose(p.set(x, PLANTER_H_M + 0.35, z), q.identity(), s.set(0.9, 0.7, 0.9));
      this.bushes.set(key, m, x, z, green.setHSL(0.3, 0.4, 0.34));
      const half = PLANTER_M / 2;
      this.#colliders.push(
        this.#physics.addBox(
          { x, y: PLANTER_H_M / 2, z },
          { x: half, y: PLANTER_H_M / 2, z: half },
        ),
      );
    });
  }
}
