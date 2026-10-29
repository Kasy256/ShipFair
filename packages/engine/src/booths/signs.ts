import {
  type Color,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  RedFormat,
  UnsignedByteType,
  Vector2,
} from 'three';
import {
  MIP_FACTOR,
  SIGN_ATLAS_COLUMNS,
  SIGN_ATLAS_PX,
  SIGN_ATLAS_ROWS,
  SIGN_TEXT_ASPECT,
} from '../config.ts';
import { InstanceBatch } from '../render/instance-batch.ts';
import { context2d, createCanvas } from '../world/textures.ts';

// Booth name signs (ARCHITECTURE.md §4): names are drawn into shared atlas pages (2048², 128
// names each) and every sign is an instance of one quad per page, so 500 names cost one draw
// call per page. Pages store only a coverage mask (one byte per texel, 5.6 MB with mips instead
// of 22 MB RGBA); board and ink colours are per instance, mixed in a small shader chunk.

const CELL_W = SIGN_ATLAS_PX / SIGN_ATLAS_COLUMNS;
const CELL_H = SIGN_ATLAS_PX / SIGN_ATLAS_ROWS;
const TEXT_W = CELL_H * SIGN_TEXT_ASPECT;
const PER_PAGE = SIGN_ATLAS_COLUMNS * SIGN_ATLAS_ROWS;
const FONT = '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MIN_FONT_PX = CELL_H * 0.32;
/** Signs sit this far in front of the slot plane, in slot units (the slot is 0.02 m deep). */
const SLOT_OFFSET = 0.6;
const ATTRIBUTES = [
  { name: 'signCell', itemSize: 2 },
  { name: 'signInk', itemSize: 3 },
] as const;
const SIGN_SCALE = new Vector2(TEXT_W / SIGN_ATLAS_PX, CELL_H / SIGN_ATLAS_PX);

const VERTEX_HEAD = /* glsl */ `
attribute vec2 signCell;
attribute vec3 signInk;
uniform vec2 signScale;
varying vec2 vSignUv;
varying vec3 vSignInk;`;
const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D signMap;
varying vec2 vSignUv;
varying vec3 vSignInk;`;

interface Page {
  readonly data: Uint8Array;
  readonly texture: DataTexture;
  readonly material: MeshBasicMaterial;
  readonly batch: InstanceBatch;
  readonly free: number[];
  isDirty: boolean;
}

interface Sign {
  readonly page: Page;
  readonly cell: number;
}

function createMaterial(texture: DataTexture): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: 0xffffff });
  material.name = 'sign-atlas';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.signMap = { value: texture };
    shader.uniforms.signScale = { value: SIGN_SCALE };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvSignUv = signCell + uv * signScale;\nvSignInk = signInk;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace(
        '#include <color_fragment>',
        // Board colour (instanceColor) first, then the lettering on top.
        '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vSignInk, texture2D(signMap, vSignUv).r);',
      );
  };
  material.customProgramCacheKey = () => 'sign-atlas';
  return material;
}

export class SignAtlas {
  readonly root = new Group();
  readonly #quad = new PlaneGeometry(1, 1).translate(0, 0, SLOT_OFFSET);
  readonly #canvas = createCanvas(TEXT_W, CELL_H);
  readonly #ctx = context2d(this.#canvas);
  readonly #pages: Page[] = [];
  readonly #signs = new Map<string, Sign>();
  readonly #extra: number[][] = [
    [0, 0],
    [0, 0, 0],
  ];

  constructor() {
    this.root.name = 'booth-signs';
  }

  get count(): number {
    return this.#signs.size;
  }

  get pageCount(): number {
    return this.#pages.length;
  }

  /** Estimated GPU bytes of all pages (one byte per texel plus mips). */
  get bytes(): number {
    return this.#pages.length * SIGN_ATLAS_PX * SIGN_ATLAS_PX * MIP_FACTOR;
  }

  /** Draws `name` (as text) into a free cell and places its sign at `matrix` (the SLOT_sign). */
  add(id: string, name: string, board: Color, ink: Color, matrix: Matrix4, x: number, z: number) {
    this.remove(id);
    const page = this.#pages.find((p) => p.free.length > 0) ?? this.#addPage();
    const cell = page.free.pop() ?? 0;
    this.#draw(page, cell, name);
    const col = cell % SIGN_ATLAS_COLUMNS;
    const row = Math.floor(cell / SIGN_ATLAS_COLUMNS);
    const [uv = [], rgb = []] = this.#extra;
    uv[0] = (col * CELL_W) / SIGN_ATLAS_PX;
    uv[1] = (row * CELL_H) / SIGN_ATLAS_PX;
    ink.toArray(rgb);
    page.batch.set(id, matrix, x, z, board, this.#extra);
    this.#signs.set(id, { page, cell });
  }

  setMatrix(id: string, matrix: Matrix4): void {
    this.#signs.get(id)?.page.batch.setMatrix(id, matrix);
  }

  remove(id: string): void {
    const sign = this.#signs.get(id);
    if (!sign) return;
    this.#signs.delete(id);
    sign.page.batch.remove(id);
    sign.page.free.push(sign.cell);
    // An empty page (other than the first) frees its texture, so memory returns to baseline.
    if (sign.page.free.length === PER_PAGE && this.#pages.length > 1) {
      this.#pages.splice(this.#pages.indexOf(sign.page), 1);
      this.#disposePage(sign.page);
    }
  }

  /** Uploads pages drawn into since last frame and packs moved signs. */
  update(): void {
    for (const page of this.#pages) {
      if (page.isDirty) {
        page.isDirty = false;
        page.texture.needsUpdate = true;
      }
      page.batch.flush();
    }
  }

  cull(x: number, z: number, radius: number): void {
    for (const page of this.#pages) page.batch.cull(x, z, radius);
  }

  dispose(): void {
    for (const page of this.#pages) this.#disposePage(page);
    this.#pages.length = 0;
    this.#signs.clear();
    this.#quad.dispose();
    this.root.removeFromParent();
  }

  #addPage(): Page {
    const data = new Uint8Array(SIGN_ATLAS_PX * SIGN_ATLAS_PX);
    const texture = new DataTexture(
      data,
      SIGN_ATLAS_PX,
      SIGN_ATLAS_PX,
      RedFormat,
      UnsignedByteType,
    );
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.anisotropy = 4;
    const material = createMaterial(texture);
    const batch = new InstanceBatch(this.root, this.#quad, material, {
      name: `signs/${this.#pages.length}`,
      hasColor: true,
      attributes: ATTRIBUTES,
      capacity: PER_PAGE,
    });
    // Cells are handed out from the end of the list, so fill from cell 0.
    const free = Array.from({ length: PER_PAGE }, (_, i) => PER_PAGE - 1 - i);
    const page: Page = { data, texture, material, batch, free, isDirty: true };
    this.#pages.push(page);
    return page;
  }

  #disposePage(page: Page): void {
    page.batch.dispose();
    page.material.dispose();
    page.texture.dispose();
  }

  /** Renders `name` as white-on-black text and copies its red channel into the page cell. */
  #draw(page: Page, cell: number, name: string): void {
    const ctx = this.#ctx;
    const w = TEXT_W;
    const h = CELL_H;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    let size = h * 0.6;
    ctx.font = `800 ${size}px ${FONT}`;
    let text = name;
    const maxW = w * 0.92;
    const measured = ctx.measureText(text).width;
    if (measured > maxW) {
      size = Math.max(MIN_FONT_PX, (size * maxW) / measured);
      ctx.font = `800 ${size}px ${FONT}`;
      if (ctx.measureText(text).width > maxW) {
        while (text.length > 1 && ctx.measureText(`${text}…`).width > maxW)
          text = text.slice(0, -1);
        text = `${text.trimEnd()}…`;
      }
    }
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h * 0.54);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    const x0 = (cell % SIGN_ATLAS_COLUMNS) * CELL_W;
    const y0 = Math.floor(cell / SIGN_ATLAS_COLUMNS) * CELL_H;
    // Canvas rows run down; texture rows run up (DataTexture, no flip).
    for (let r = 0; r < h; r++) {
      const dst = (y0 + h - 1 - r) * SIGN_ATLAS_PX + x0;
      for (let c = 0; c < w; c++) page.data[dst + c] = pixels[(r * w + c) * 4] ?? 0;
    }
    page.isDirty = true;
  }
}
