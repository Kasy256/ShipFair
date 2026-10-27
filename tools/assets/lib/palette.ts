import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as z from 'zod';
import { decodePng, encodePng } from './png.ts';

export const PALETTE_GRID = 4;
export const PALETTE_PX = 256;

export const PaletteFile = z.object({
  colors: z
    .array(z.object({ name: z.string(), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }))
    .length(PALETTE_GRID * PALETTE_GRID),
});

/**
 * 4×4 flat squares, 256×256, colour i at column i % 4 and row ⌊i / 4⌋ from the top (glTF UV
 * space, where v = 0 is the top row), matching tools/blender/lib/palette.py.
 */
export function palettePng(hexes: readonly string[]): Buffer {
  const cell = PALETTE_PX / PALETTE_GRID;
  const rgb = new Uint8Array(PALETTE_PX * PALETTE_PX * 3);
  for (let y = 0; y < PALETTE_PX; y++) {
    for (let x = 0; x < PALETTE_PX; x++) {
      const i = Math.floor(y / cell) * PALETTE_GRID + Math.floor(x / cell);
      const n = Number.parseInt((hexes[i] ?? '#ff00ff').slice(1), 16);
      rgb.set([(n >> 16) & 255, (n >> 8) & 255, n & 255], (y * PALETTE_PX + x) * 3);
    }
  }
  return encodePng(PALETTE_PX, PALETTE_PX, rgb);
}

/** Writes the PNG only when its pixels change (Blender's encoder makes different bytes). */
export function writePaletteIfChanged(file: string, png: Buffer): boolean {
  if (existsSync(file)) {
    const old = decodePng(readFileSync(file)).rgb;
    const next = decodePng(png).rgb;
    if (old.length === next.length && old.every((v, i) => v === next[i])) return false;
  }
  writeFileSync(file, png);
  return true;
}
