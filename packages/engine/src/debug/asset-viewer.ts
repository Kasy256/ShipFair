import type { AvatarStyleV2, EventBus } from '@shipfair/shared';
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Matrix4,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Art } from '../art.ts';
import { GltfAvatar } from '../avatars/gltf-avatar.ts';
import { Loop } from '../core/loop.ts';
import type { InstanceSet } from '../render/instance-set.ts';
import { slotGizmos } from './slot-gizmos.ts';

const TURN_RAD_PER_S = 0.4;
const BACKGROUND = 0x20232b;
const FIT_MARGIN = 1.25;

/** A live viewport in the grid. `dispose` removes it. */
export interface AssetView {
  dispose(): void;
}

export interface CharacterView extends AssetView {
  setStyle(style: AvatarStyleV2): void;
  /** Loops a clip by name; null returns to idle. */
  playClip(name: string | null): void;
  readonly triangles: number;
}

interface Cell {
  readonly element: HTMLElement;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly pivot: Object3D;
  tick?: (dt: number) => void;
  release(): void;
}

const centre = new Vector3();
const size = new Vector3();

/**
 * The /dev/assets renderer: one WebGLRenderer for every card, each drawn into its element's
 * rectangle with the scissor test (three's "multiple elements" pattern). Models turn slowly so
 * the artist sees every side. Dev and staging only; the web shell never bundles it in production.
 */
export class AssetViewer {
  readonly art: Art;
  readonly #renderer: WebGLRenderer;
  readonly #canvas: HTMLCanvasElement;
  readonly #loop = new Loop();
  readonly #cells = new Set<Cell>();

  private constructor(canvas: HTMLCanvasElement, renderer: WebGLRenderer, art: Art) {
    this.#canvas = canvas;
    this.#renderer = renderer;
    this.art = art;
    this.#loop.add({ update: (dt) => this.#render(dt), dispose: () => undefined });
    this.#loop.start();
  }

  static async create(canvas: HTMLCanvasElement, bus: EventBus): Promise<AssetViewer> {
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setScissorTest(true);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    return new AssetViewer(canvas, renderer, await Art.load(bus, renderer));
  }

  /** A v2 avatar at `lod`, animated by the shared clip set. */
  async addCharacter(
    element: HTMLElement,
    style: AvatarStyleV2,
    lod: 0 | 1,
  ): Promise<CharacterView> {
    const factory = this.art.factory;
    if (!factory) throw new Error('no asset manifest: characters need pnpm assets:build');
    const avatar = await GltfAvatar.create(factory, this.art.animations, style, lod);
    const cell = this.#cell(element, avatar.object, () => avatar.dispose());
    cell.tick = (dt) => avatar.update(dt, 0);
    return {
      setStyle: (s) => avatar.setStyle(s),
      playClip: (name) => avatar.animator.preview(name),
      get triangles() {
        const index = avatar.character.mesh.geometry.getIndex();
        return index ? index.count / 3 : 0;
      },
      dispose: () => this.#drop(cell),
    };
  }

  /** One booth tier with its `SLOT_*` gizmos labelled. */
  addTier(element: HTMLElement, tier: string): AssetView {
    const set: InstanceSet = this.art.kit.build([
      { tier, matrix: new Matrix4(), accent: new Color(0x7c5cff), glow: new Color(0x3fa7f5) },
    ]);
    const gizmos = slotGizmos(this.art.kit.tiers.get(tier)?.slots ?? []);
    set.group.add(gizmos.object);
    const cell = this.#cell(element, set.group, () => {
      gizmos.dispose();
      set.dispose();
    });
    return { dispose: () => this.#drop(cell) };
  }

  addProp(element: HTMLElement, id: string): AssetView {
    const { set } = this.art.props.build([{ id, x: 0, z: 0, yaw: 0 }]);
    const cell = this.#cell(element, set.group, () => set.dispose());
    return { dispose: () => this.#drop(cell) };
  }

  dispose(): void {
    for (const cell of this.#cells) cell.release();
    this.#cells.clear();
    this.#loop.dispose();
    this.art.dispose();
    this.#renderer.dispose();
  }

  #cell(element: HTMLElement, object: Object3D, release: () => void): Cell {
    const scene = new Scene();
    scene.background = new Color(BACKGROUND);
    scene.add(new AmbientLight(0xffffff, 1.2));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    const pivot = new Scene();
    pivot.add(object);
    scene.add(pivot);
    const box = new Box3().setFromObject(object, true);
    box.getCenter(centre);
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z, 0.5) * FIT_MARGIN;
    const camera = new PerspectiveCamera(35, 1, 0.05, 500);
    camera.position.set(centre.x, centre.y + radius * 0.35, centre.z + radius * 1.9);
    camera.lookAt(centre);
    const cell: Cell = { element, scene, camera, pivot, release };
    this.#cells.add(cell);
    return cell;
  }

  #drop(cell: Cell): void {
    if (!this.#cells.delete(cell)) return;
    cell.release();
  }

  #render(dt: number): void {
    const canvas = this.#canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (
      canvas.width !== Math.floor(width * this.#renderer.getPixelRatio()) ||
      canvas.height !== Math.floor(height * this.#renderer.getPixelRatio())
    ) {
      this.#renderer.setSize(width, height, false);
    }
    this.#renderer.setClearColor(0x000000, 0);
    this.#renderer.setScissor(0, 0, width, height);
    this.#renderer.clear();
    const frame = canvas.getBoundingClientRect();
    for (const cell of this.#cells) {
      cell.tick?.(dt);
      cell.pivot.rotation.y += dt * TURN_RAD_PER_S;
      const rect = cell.element.getBoundingClientRect();
      if (rect.bottom < frame.top || rect.top > frame.bottom || rect.width === 0) continue;
      const left = rect.left - frame.left;
      const bottom = frame.bottom - rect.bottom;
      this.#renderer.setViewport(left, bottom, rect.width, rect.height);
      this.#renderer.setScissor(left, bottom, rect.width, rect.height);
      cell.camera.aspect = rect.width / rect.height;
      cell.camera.updateProjectionMatrix();
      this.#renderer.render(cell.scene, cell.camera);
    }
  }
}
