// The palette stays a small PNG sampled with nearest filtering and no mipmaps (linear filtering or
// mips blend neighbouring squares). Any other texture goes to KTX2 through KTX-Software's `toktx`:
// ETC1S for colour, UASTC for normal maps, at most 1024 px; files with such textures also get a
// 512 px copy for the low tier (prompt 14). No texture ships without a KTX2 path: without toktx
// the build fails instead of copying the PNG through.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Document, ImageUtils, type Texture } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { listTextureSlots } from '@gltf-transform/functions';

/** Longest texture side per variant: the normal file, and the low tier's `.low` copy. */
export const TEXTURE_MAX_PX = { high: 1024, low: 512 } as const;
// WebGL enums as glTF stores them.
const NEAREST = 9728;
const CLAMP_TO_EDGE = 33071;

let toktx: string | null | undefined;

/** `toktx` on PATH (or `TOKTX_PATH`), or null when KTX-Software isn't installed. */
export function findToktx(): string | null {
  if (toktx !== undefined) return toktx;
  const candidate = process.env.TOKTX_PATH ?? 'toktx';
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  toktx = probe.status === 0 ? candidate : null;
  return toktx;
}

export function isPaletteTexture(
  doc: Document,
  texture: Texture,
  paletteMaterial: string,
): boolean {
  if (/palette/i.test(texture.getName()) || /palette/i.test(texture.getURI())) return true;
  return doc
    .getRoot()
    .listMaterials()
    .some((m) => m.getName() === paletteMaterial && m.getBaseColorTexture() === texture);
}

function paletteSampler(doc: Document, texture: Texture): void {
  for (const material of doc.getRoot().listMaterials()) {
    if (material.getBaseColorTexture() !== texture) continue;
    const info = material.getBaseColorTextureInfo();
    info?.setMinFilter(NEAREST);
    info?.setMagFilter(NEAREST);
    info?.setWrapS(CLAMP_TO_EDGE);
    info?.setWrapT(CLAMP_TO_EDGE);
  }
}

function encodeKtx2(texture: Texture, isNormal: boolean, exe: string, maxPx: number): Uint8Array {
  const image = texture.getImage();
  if (!image) throw new Error('texture has no image');
  const [w = 1, h = 1] = ImageUtils.getSize(image, texture.getMimeType()) ?? [];
  const scale = Math.min(1, maxPx / Math.max(w, h));
  const dir = mkdtempSync(join(tmpdir(), 'shipfair-ktx-'));
  try {
    const ext = texture.getMimeType() === 'image/jpeg' ? 'jpg' : 'png';
    const input = join(dir, `in.${ext}`);
    const output = join(dir, 'out.ktx2');
    writeFileSync(input, image);
    const args = ['--t2', '--genmipmap'];
    if (scale < 1) args.push('--resize', `${Math.round(w * scale)}x${Math.round(h * scale)}`);
    if (isNormal) args.push('--encode', 'uastc', '--assign_oetf', 'linear', '--zcmp', '18');
    else args.push('--encode', 'etc1s', '--assign_oetf', 'srgb');
    const run = spawnSync(exe, [...args, output, input], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(run.stderr || `toktx exited with ${run.status}`);
    return readFileSync(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** True when the file has textures other than the palette that still need KTX2 encoding. */
export function needsKtx2(doc: Document, paletteMaterial: string): boolean {
  return doc
    .getRoot()
    .listTextures()
    .some((t) => !isPaletteTexture(doc, t, paletteMaterial) && t.getMimeType() !== 'image/ktx2');
}

/**
 * Fixes palette sampling and converts every other texture, at most `maxPx` on the longest side.
 * Returns problems (as errors).
 */
export function processTextures(
  doc: Document,
  file: string,
  paletteMaterial: string,
  maxPx: number = TEXTURE_MAX_PX.high,
): string[] {
  const errors: string[] = [];
  const others: Texture[] = [];
  for (const texture of doc.getRoot().listTextures()) {
    if (isPaletteTexture(doc, texture, paletteMaterial)) paletteSampler(doc, texture);
    else if (texture.getMimeType() !== 'image/ktx2') others.push(texture);
  }
  if (others.length === 0) return errors;
  const exe = findToktx();
  if (!exe) {
    const names = others.map((t) => t.getName() || t.getURI() || 'unnamed').join(', ');
    return [
      `${file}: textures ${names} need KTX2; install KTX-Software (toktx) or bake to the palette`,
    ];
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const texture of others) {
    const isNormal = listTextureSlots(texture).includes('normalTexture');
    try {
      texture.setImage(encodeKtx2(texture, isNormal, exe, maxPx)).setMimeType('image/ktx2');
      texture.setURI(texture.getURI().replace(/\.(png|jpe?g)$/i, '.ktx2'));
    } catch (error) {
      errors.push(`${file}: KTX2 encoding of ${texture.getName()} failed: ${String(error)}`);
    }
  }
  return errors;
}
