import { type PerspectiveCamera, type Ray, Raycaster, Vector2, type Vector3 } from 'three';

/**
 * Between the canvas (client px) and the world: the ray under a click or tap, and where a world
 * point shows on screen. Scratch objects are reused; clicks are rare, but there's no reason to
 * allocate.
 */
export class ScreenRay {
  readonly #canvas: HTMLCanvasElement;
  readonly #raycaster = new Raycaster();
  readonly #pointer = new Vector2();

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
  }

  /** The (reused) ray under a client point, or null while the canvas has no size. */
  cast(clientX: number, clientY: number, camera: PerspectiveCamera): Ray | null {
    const rect = this.#canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.#pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    // Test mode renders only on request, so the camera's matrices may be a frame old.
    camera.updateMatrixWorld();
    this.#raycaster.setFromCamera(this.#pointer, camera);
    return this.#raycaster.ray;
  }

  /** Where `point` shows on screen, in client px. Overwrites `point`. */
  project(point: Vector3, camera: PerspectiveCamera): { x: number; y: number } {
    camera.updateMatrixWorld();
    point.project(camera);
    const rect = this.#canvas.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - point.y) / 2) * rect.height,
    };
  }
}
