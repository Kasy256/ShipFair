import type { AvatarStyleV2, EventBus } from '@shipfair/shared';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { AssetManager } from '../assets/asset-manager.ts';
import { createGltfLoader } from '../assets/gltf-loader.ts';
import { Loop } from '../core/loop.ts';
import { type AvatarView, EMOTE_WAVE, ProceduralAvatar } from '../player/avatar.ts';
import { AnimationSet } from './animation-set.ts';
import { CharacterFactory } from './character-factory.ts';
import { GltfAvatar } from './gltf-avatar.ts';

const BACKGROUND = 0x20232b;
const FOV_DEG = 28;
const CAMERA = { y: 1.05, z: 4.2, lookY: 0.92 } as const;
const MAX_PIXEL_RATIO = 2;
/** Radians of turn per pixel dragged. */
const DRAG_RAD_PER_PX = 0.012;

/**
 * The avatar editor's live preview (prompt 07): one character at LOD0 on its own small canvas,
 * with its own WebGLRenderer and loop, separate from the world. It loads only the manifest, the
 * clips and the character parts (no booth kit or props), waves once when opened, and turns when
 * dragged. `dispose()` frees every GPU resource and the WebGL context.
 */
export class AvatarPreview {
  readonly #renderer: WebGLRenderer;
  readonly #canvas: HTMLCanvasElement;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(FOV_DEG, 1, 0.05, 50);
  readonly #loop = new Loop();
  readonly #assets: AssetManager;
  readonly #animations: AnimationSet;
  readonly #factory: CharacterFactory | null;
  readonly #resize: ResizeObserver;
  readonly #offPointer: () => void;
  #avatar: AvatarView;
  #style: AvatarStyleV2;
  #isDisposed = false;

  private constructor(
    canvas: HTMLCanvasElement,
    renderer: WebGLRenderer,
    parts: { assets: AssetManager; animations: AnimationSet; factory: CharacterFactory | null },
    avatar: AvatarView,
    style: AvatarStyleV2,
  ) {
    this.#canvas = canvas;
    this.#renderer = renderer;
    this.#assets = parts.assets;
    this.#animations = parts.animations;
    this.#factory = parts.factory;
    this.#avatar = avatar;
    this.#style = style;
    this.#scene.background = new Color(BACKGROUND);
    this.#scene.add(new AmbientLight(0xffffff, 1.3));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 5);
    this.#scene.add(sun, avatar.object);
    this.#camera.position.set(0, CAMERA.y, CAMERA.z);
    this.#camera.lookAt(0, CAMERA.lookY, 0);
    this.#resize = new ResizeObserver(() => this.#fit());
    this.#resize.observe(canvas);
    this.#offPointer = this.#listenDrag();
    this.#fit();
    this.#loop.add({
      update: (dt) => {
        this.#avatar.update(dt, this.#loop.time);
        this.#renderer.render(this.#scene, this.#camera);
      },
      dispose: () => undefined,
    });
    avatar.playEmote(EMOTE_WAVE);
    this.#loop.start();
  }

  /** Builds the preview on `canvas` and starts it. The avatar waves (`emote_wave`) on open. */
  static async create(
    canvas: HTMLCanvasElement,
    bus: EventBus,
    style: AvatarStyleV2,
  ): Promise<AvatarPreview> {
    const renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
    const assets = new AssetManager(bus, createGltfLoader(renderer));
    try {
      const manifest = await assets.loadManifest();
      const animations = await AnimationSet.load(assets, manifest);
      const factory = manifest ? new CharacterFactory(assets, manifest) : null;
      const canBuild = factory?.hasBody(`body_${style.body}`) === true && animations.canLocomote;
      const avatar =
        factory && canBuild
          ? await GltfAvatar.create(factory, animations, style, 0)
          : new ProceduralAvatar(style);
      return new AvatarPreview(canvas, renderer, { assets, animations, factory }, avatar, style);
    } catch (error) {
      assets.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      throw error;
    }
  }

  get style(): AvatarStyleV2 {
    return this.#style;
  }

  /** The item-set key on screen (it changes once a new outfit has been built), for tests. */
  get key(): string {
    const avatar = this.#avatar;
    return avatar instanceof GltfAvatar ? avatar.character.key : 'procedural';
  }

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  /** Colours update at once; new items or a new body rebuild in the background and swap in. */
  setStyle(style: AvatarStyleV2): void {
    if (this.#isDisposed) return;
    this.#style = style;
    this.#avatar.setStyle(style);
  }

  wave(): void {
    this.#avatar.playEmote(EMOTE_WAVE);
  }

  dispose(): void {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    this.#resize.disconnect();
    this.#offPointer();
    this.#loop.dispose();
    this.#avatar.dispose();
    this.#factory?.dispose();
    this.#animations.dispose();
    this.#assets.dispose();
    this.#scene.clear();
    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
  }

  #fit(): void {
    const { clientWidth: w, clientHeight: h } = this.#canvas;
    if (w === 0 || h === 0) return;
    this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
  }

  #listenDrag(): () => void {
    const canvas = this.#canvas;
    let lastX: number | null = null;
    const down = (e: PointerEvent) => {
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (lastX === null) return;
      this.#avatar.object.rotation.y += (e.clientX - lastX) * DRAG_RAD_PER_PX;
      lastX = e.clientX;
    };
    const up = () => {
      lastX = null;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }
}
