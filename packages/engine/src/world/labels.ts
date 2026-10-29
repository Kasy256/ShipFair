import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from 'three';
import type { UvRect } from './static-merge.ts';
import { context2d, createCanvas } from './textures.ts';

export interface LabelSpec {
  readonly text: string;
  readonly board: number;
  readonly ink: number;
  /** A strip along the bottom edge, e.g. the district colour. */
  readonly strip?: number;
}

const ATLAS_PX = 1024;
const COLUMNS = 2;
const CELL_W = ATLAS_PX / COLUMNS;
const CELL_H = 96;
const ROWS = Math.floor(ATLAS_PX / CELL_H);
/** Width ÷ height of every label cell, so panels can be sized to match. */
export const LABEL_ASPECT = CELL_W / CELL_H;
const FONT = '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * District names and plaza labels drawn into one canvas texture, so every gate, signpost and
 * kiosk panel shares a material and merges into one mesh (planes take their cell's UVs).
 */
export class LabelAtlas {
  readonly texture: Texture;
  readonly #rects: UvRect[] = [];

  constructor(labels: readonly LabelSpec[]) {
    if (labels.length > COLUMNS * ROWS) throw new RangeError('LabelAtlas: too many labels');
    const canvas = createCanvas(ATLAS_PX, ATLAS_PX);
    const ctx = context2d(canvas);
    labels.forEach((label, i) => {
      const x = (i % COLUMNS) * CELL_W;
      const y = Math.floor(i / COLUMNS) * CELL_H;
      ctx.fillStyle = css(label.board);
      ctx.fillRect(x, y, CELL_W, CELL_H);
      if (label.strip !== undefined) {
        ctx.fillStyle = css(label.strip);
        ctx.fillRect(x, y + CELL_H - 10, CELL_W, 10);
      }
      let size = CELL_H * 0.5;
      ctx.font = `800 ${size}px ${FONT}`;
      const width = ctx.measureText(label.text).width;
      if (width > CELL_W * 0.9) size *= (CELL_W * 0.9) / width;
      ctx.font = `800 ${size}px ${FONT}`;
      ctx.fillStyle = css(label.ink);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.text, x + CELL_W / 2, y + CELL_H * 0.46);
      // Canvas rows run down, UVs up (flipY is on for canvas textures).
      this.#rects.push({
        u0: x / ATLAS_PX,
        u1: (x + CELL_W) / ATLAS_PX,
        v0: 1 - (y + CELL_H) / ATLAS_PX,
        v1: 1 - y / ATLAS_PX,
      });
    });
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = 4;
    this.texture = texture;
  }

  /** UVs of label `index` (in the order given to the constructor). */
  rect(index: number): UvRect {
    const rect = this.#rects[index];
    if (!rect) throw new RangeError(`LabelAtlas: no label ${index}`);
    return rect;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
