import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  type Scene,
} from 'three';
import type { System } from '../core/loop.ts';
import type { PhysicsWorld } from '../physics/world.ts';

/**
 * `?debug=physics`: Rapier's own debug lines for every collider, redrawn each frame. Debug
 * only: `world.debugRender()` returns fresh arrays, so this path allocates.
 */
export class PhysicsWireframe implements System {
  readonly #physics: PhysicsWorld;
  readonly #geometry = new BufferGeometry();
  readonly #material = new LineBasicMaterial({ vertexColors: true, depthTest: false });
  readonly #lines: LineSegments;

  constructor(physics: PhysicsWorld, scene: Scene) {
    this.#physics = physics;
    this.#lines = new LineSegments(this.#geometry, this.#material);
    this.#lines.name = 'physics-wireframe';
    this.#lines.frustumCulled = false;
    this.#lines.renderOrder = 999;
    scene.add(this.#lines);
  }

  update(): void {
    if (!this.#physics.isAlive) return;
    const { vertices, colors } = this.#physics.world.debugRender();
    this.#geometry.setAttribute('position', new BufferAttribute(vertices, 3));
    this.#geometry.setAttribute('color', new BufferAttribute(colors, 4));
  }

  dispose(): void {
    this.#lines.removeFromParent();
    this.#geometry.dispose();
    this.#material.dispose();
  }
}
