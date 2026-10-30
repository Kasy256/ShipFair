import type { EventBus } from '@shipfair/shared';
import {
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from 'three';
import { AssetManager } from '../assets/asset-manager.ts';
import { createGltfLoader } from '../assets/gltf-loader.ts';
import { loadPalette, PaletteMaterials } from '../assets/palette.ts';
import { Loop } from '../core/loop.ts';
import type { InstanceSet } from '../render/instance-set.ts';
import { accentFor, themeFor } from '../world/themes.ts';
import { BoothKit, type KitBooth } from './kit.ts';
import { monogram } from './media.ts';

/** What the submission form shows: the real shell for the district theme, with the new media. */
export interface BoothPreviewContent {
  readonly name: string;
  /** District theme key (`districts.theme`) and colour (GLOW parts). */
  readonly theme: string;
  readonly districtColor: string;
  /** Picks the accent colour like the city does; any stable string works for a new booth. */
  readonly accentSeed: string;
  readonly logo: Blob | null;
  readonly screenshots: readonly Blob[];
}

/** For tests: what the preview is showing. */
export interface BoothPreviewStats {
  readonly theme: string;
  readonly kitParts: number;
  readonly hasLogo: boolean;
  readonly screens: number;
}

const TIER = 'stall';
const BACKGROUND = 0x20232b;
const FOV_DEG = 35;
const CAMERA = { x: 4.5, y: 3.4, z: 9.5, lookY: 1.4 } as const;
const GROUND_RADIUS_M = 7;
const MAX_PIXEL_RATIO = 2;
const DRAG_RAD_PER_PX = 0.01;
/** Seconds of drawing after a change; then the last frame stays up (see AvatarPreview). */
const ACTIVE_S = 1;
/** Content quads sit in front of their slot, in slot units (as booths/content.ts). */
const SLOT_OFFSET = 0.7;
const SCREEN_SLOTS = ['SLOT_screen_0', 'SLOT_screen_1'] as const;

/** A WebGL texture from an image file, flipped at decode like the city's texture cache. */
async function textureFrom(blob: Blob): Promise<Texture> {
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: 'flipY',
    premultiplyAlpha: 'none',
  });
  const texture = new Texture(bitmap as unknown as HTMLImageElement);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function disposeTexture(texture: Texture): void {
  const image: unknown = texture.image;
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
  texture.dispose();
}

/**
 * The `/submit` form's live booth (prompt 08): one stall built from the real booth kit and the
 * district theme, with the maker's logo and screenshots on its slots, on its own small canvas
 * and WebGLRenderer. It loads only the manifest, palette and kit. It draws for a moment after
 * each change or drag, then holds the last frame. `dispose()` frees everything and the context.
 */
export class BoothPreview {
  readonly #renderer: WebGLRenderer;
  readonly #canvas: HTMLCanvasElement;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
  readonly #loop = new Loop();
  readonly #assets: AssetManager;
  readonly #materials: PaletteMaterials;
  readonly #kit: BoothKit;
  readonly #booth = new Group();
  readonly #quad = new PlaneGeometry(1, 1).translate(0, 0, SLOT_OFFSET);
  readonly #ground: Mesh<CircleGeometry, MeshStandardMaterial>;
  readonly #resize: ResizeObserver;
  readonly #offPointer: () => void;
  #shell: InstanceSet | null = null;
  #displays: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  #textures: Texture[] = [];
  #stats: BoothPreviewStats;
  /** Bumped per `setContent`, so a slow decode never lands on newer content. */
  #generation = 0;
  #activeS = ACTIVE_S;
  #isDisposed = false;

  private constructor(
    canvas: HTMLCanvasElement,
    renderer: WebGLRenderer,
    parts: { assets: AssetManager; materials: PaletteMaterials; kit: BoothKit },
    content: BoothPreviewContent,
  ) {
    this.#canvas = canvas;
    this.#renderer = renderer;
    this.#assets = parts.assets;
    this.#materials = parts.materials;
    this.#kit = parts.kit;
    this.#stats = { theme: content.theme, kitParts: 0, hasLogo: false, screens: 0 };
    this.#scene.background = new Color(BACKGROUND);
    this.#scene.add(new AmbientLight(0xffffff, 1.4));
    const sun = new DirectionalLight(0xffffff, 2.4);
    sun.position.set(4, 8, 6);
    this.#ground = new Mesh(
      new CircleGeometry(GROUND_RADIUS_M, 48).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ roughness: 0.9 }),
    );
    this.#scene.add(sun, this.#ground, this.#booth);
    this.#camera.position.set(CAMERA.x, CAMERA.y, CAMERA.z);
    this.#camera.lookAt(0, CAMERA.lookY, 0);
    this.#resize = new ResizeObserver(() => this.#fit());
    this.#resize.observe(canvas);
    this.#offPointer = this.#listenDrag();
    this.#fit();
    this.#loop.add({
      update: (dt) => {
        if (this.#activeS <= 0) return;
        this.#activeS -= dt;
        this.#renderer.render(this.#scene, this.#camera);
      },
      dispose: () => undefined,
    });
    this.#loop.start();
  }

  static async create(
    canvas: HTMLCanvasElement,
    bus: EventBus,
    content: BoothPreviewContent,
  ): Promise<BoothPreview> {
    const renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
    const assets = new AssetManager(bus, createGltfLoader(renderer));
    let materials: PaletteMaterials | null = null;
    try {
      const manifest = await assets.loadManifest();
      materials = new PaletteMaterials(await loadPalette(manifest?.palette.url ?? null));
      const kit = await BoothKit.load(assets, manifest, materials);
      const preview = new BoothPreview(canvas, renderer, { assets, materials, kit }, content);
      await preview.setContent(content);
      return preview;
    } catch (error) {
      materials?.dispose();
      assets.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      throw error;
    }
  }

  get stats(): BoothPreviewStats {
    return this.#stats;
  }

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  /** Rebuilds the shell for the theme and swaps in the media. Resolves once it is on screen. */
  async setContent(content: BoothPreviewContent): Promise<void> {
    if (this.#isDisposed) return;
    const generation = ++this.#generation;
    const [logo, ...screens] = await Promise.all([
      content.logo ? textureFrom(content.logo) : Promise.resolve(null),
      ...content.screenshots.slice(0, SCREEN_SLOTS.length).map(textureFrom),
    ]);
    const decoded = [logo, ...screens].filter((t): t is Texture => t !== null);
    if (this.#isDisposed || generation !== this.#generation) {
      for (const t of decoded) disposeTexture(t);
      return;
    }
    this.#clear();
    const theme = themeFor(content.theme);
    this.#ground.material.color.setHex(theme.ground.color);
    const booth: KitBooth = {
      tier: `tier_${TIER}`,
      matrix: new Matrix4(),
      accent: new Color(accentFor(theme, content.accentSeed)),
      glow: new Color(content.districtColor),
      ...(theme.kitVariant ? { theme: theme.kitVariant } : {}),
    };
    this.#shell = this.#kit.build([booth]);
    this.#booth.add(this.#shell.group);

    const placeholder = monogram(content.name, booth.accent);
    this.#textures = [placeholder, ...decoded];
    const show = (slot: string, texture: Texture | null | undefined): boolean => {
      const mesh = new Mesh(this.#quad, new MeshBasicMaterial({ map: texture ?? placeholder }));
      mesh.matrixAutoUpdate = false;
      if (!this.#kit.slotMatrix(booth, slot, mesh.matrix)) {
        mesh.material.dispose();
        return false;
      }
      this.#booth.add(mesh);
      this.#displays.push(mesh);
      return true;
    };
    const hasLogo = show('SLOT_logo', logo) && logo !== null;
    let shown = 0;
    SCREEN_SLOTS.forEach((slot, i) => {
      if (show(slot, screens[i]) && screens[i]) shown++;
    });
    this.#stats = {
      theme: content.theme,
      kitParts: this.#shell.meshes.length,
      hasLogo,
      screens: shown,
    };
    this.#wake();
  }

  dispose(): void {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    this.#resize.disconnect();
    this.#offPointer();
    this.#loop.dispose();
    this.#clear();
    this.#quad.dispose();
    this.#ground.geometry.dispose();
    this.#ground.material.dispose();
    this.#kit.dispose();
    this.#materials.dispose();
    this.#assets.dispose();
    this.#scene.clear();
    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
  }

  #clear(): void {
    this.#shell?.group.removeFromParent();
    this.#shell?.dispose();
    this.#shell = null;
    for (const mesh of this.#displays) {
      mesh.removeFromParent();
      mesh.material.dispose();
    }
    this.#displays = [];
    for (const texture of this.#textures) disposeTexture(texture);
    this.#textures = [];
  }

  #wake(): void {
    this.#activeS = ACTIVE_S;
  }

  #fit(): void {
    const { clientWidth: w, clientHeight: h } = this.#canvas;
    if (w === 0 || h === 0) return;
    this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
    this.#wake();
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
      this.#booth.rotation.y += (e.clientX - lastX) * DRAG_RAD_PER_PX;
      lastX = e.clientX;
      this.#wake();
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
