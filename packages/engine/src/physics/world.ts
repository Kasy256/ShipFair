import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT_S, GRAVITY_MPS2 } from '../config.ts';
import type { System } from '../core/loop.ts';

export { RAPIER };

let rapierReady: Promise<void> | undefined;

/** Loads the Rapier WASM once per page (the compat build inlines it, so there's no fetch). */
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

// Collision groups: the high 16 bits say what a collider is, the low 16 what it collides with.
export const GROUP_STATIC = 0x0001;
export const GROUP_PLAYER = 0x0002;
const ALL = 0xffff;
const groups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;
/** Ray filter that sees only level geometry (never the player's own capsule). */
export const STATIC_ONLY = groups(ALL, GROUP_STATIC);

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/**
 * The Rapier world plus helpers for static level geometry. Only primitive and convex colliders
 * are offered: trimeshes are banned for anything dynamic (TECH_STACK.md, rapier #1027).
 * Call `initPhysics()` before constructing one.
 */
export class PhysicsWorld implements System {
  readonly world: RAPIER.World;
  readonly #ray: RAPIER.Ray;
  #isAlive = true;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY_MPS2, z: 0 });
    this.world.timestep = FIXED_DT_S;
    this.#ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  addBox(center: Vec3, halfExtents: Vec3, rotation: Quat = IDENTITY): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    return this.#addStatic(desc, center, rotation);
  }

  addCylinder(center: Vec3, halfHeight: number, radius: number): RAPIER.Collider {
    return this.#addStatic(RAPIER.ColliderDesc.cylinder(halfHeight, radius), center, IDENTITY);
  }

  /** Convex hull of `points` (x, y, z triples, local to `center`). */
  addConvex(center: Vec3, points: Float32Array, rotation: Quat = IDENTITY): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.convexHull(points);
    if (!desc) throw new Error('PhysicsWorld.addConvex: points do not form a convex hull');
    return this.#addStatic(desc, center, rotation);
  }

  /**
   * Distance along a unit `dir` to the first static surface, or `maxDist` when nothing is hit.
   * The ray is solid, so an origin inside geometry returns 0.
   */
  castRay(origin: Vec3, dir: Vec3, maxDist: number): number {
    const ray = this.#ray;
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = dir.x;
    ray.dir.y = dir.y;
    ray.dir.z = dir.z;
    const hit = this.world.castRay(ray, maxDist, true, undefined, STATIC_ONLY);
    return hit ? hit.timeOfImpact : maxDist;
  }

  /** True when the point lies inside any static collider. */
  isInsideStatic(point: Vec3): boolean {
    this.#hasHit = false;
    this.world.intersectionsWithPoint(point, this.#onHit, undefined, STATIC_ONLY);
    return this.#hasHit;
  }

  // Bound once: the camera checks a point every frame, and a fresh closure would allocate.
  #hasHit = false;
  readonly #onHit = (): boolean => {
    this.#hasHit = true;
    return false; // one hit is enough
  };

  /** False once disposed; Rapier objects must not be touched after `world.free()`. */
  get isAlive(): boolean {
    return this.#isAlive;
  }

  fixedUpdate(): void {
    this.world.step();
  }

  dispose(): void {
    if (!this.#isAlive) return;
    this.#isAlive = false;
    this.world.free();
  }

  #addStatic(desc: RAPIER.ColliderDesc, center: Vec3, rotation: Quat): RAPIER.Collider {
    desc
      .setTranslation(center.x, center.y, center.z)
      .setRotation(rotation)
      .setCollisionGroups(groups(GROUP_STATIC, ALL));
    return this.world.createCollider(desc);
  }
}
