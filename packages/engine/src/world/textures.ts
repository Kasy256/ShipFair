import { rng } from '@shipfair/shared';
import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { GroundPattern } from './themes.ts';

// Cheap procedural ground detail with no asset bytes (the prototype's `noiseTex`), drawn grey
// so one texture per pattern serves every theme: the material colour tints it. Seeded, so every
// client draws the same pixels.

const SIZE_PX = 256;
const NOISE = 26;
/** #d0d0d0, the grey the noise sits on. */
const BASE_GREY = 0xd0;

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * `willReadFrequently` keeps the canvas on the CPU: for one read back with `getImageData`,
 * where a GPU-backed canvas would stall on a readback each time (207 ms each under SwiftShader).
 */
export function context2d(
  canvas: HTMLCanvasElement,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', options);
  if (!ctx) throw new Error('2D canvas is unavailable');
  return ctx;
}

function draw(pattern: GroundPattern | 'plain', ctx: CanvasRenderingContext2D, seed: number): void {
  const s = SIZE_PX;
  const random = rng(seed);
  // Built on the CPU and written once: reading a GPU canvas back (getImageData) stalls the boot
  // (prompt 14 measured ~9 s for the city's ground textures under SwiftShader).
  const img = new ImageData(s, s);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (random() - 0.5) * NOISE;
    d[i] = BASE_GREY + n;
    d[i + 1] = BASE_GREY + n;
    d[i + 2] = BASE_GREY + n;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 3;
  const grid = (n: number, offsetRows: boolean) => {
    const step = s / n;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(s, i * step);
      ctx.stroke();
      for (let j = 0; j <= n; j++) {
        const x = j * step + (offsetRows && i % 2 === 1 ? step / 2 : 0);
        ctx.beginPath();
        ctx.moveTo(x, i * step);
        ctx.lineTo(x, (i + 1) * step);
        ctx.stroke();
      }
    }
  };
  if (pattern === 'pavers') grid(4, true);
  if (pattern === 'tiles') grid(2, false);
  if (pattern === 'concrete') grid(1, false);
  if (pattern === 'planks') {
    const rows = 8;
    const h = s / rows;
    for (let i = 0; i < rows; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.04 + random() * 0.08})`;
      ctx.fillRect(0, i * h, s, h);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, i * h, s, 2);
      ctx.fillRect(Math.floor(random() * s), i * h, 2, h);
    }
  }
}

/** A tiling grey ground texture for `pattern` (sRGB, mipmapped, repeat-wrapped). */
export function groundTexture(pattern: GroundPattern | 'asphalt' | 'grass'): Texture {
  const canvas = createCanvas(SIZE_PX, SIZE_PX);
  const ctx = context2d(canvas);
  // Open ground is plain noise, so its repeats show no seams.
  if (pattern === 'asphalt' || pattern === 'grass')
    draw('plain', ctx, pattern === 'grass' ? 11 : 7);
  else draw(pattern, ctx, 3);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}
