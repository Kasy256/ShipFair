import { CanvasTexture, type Color, SRGBColorSpace } from 'three';
import { MONOGRAM_PX } from '../config.ts';
import { context2d, createCanvas } from '../world/textures.ts';

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * The URL of a media key on the media host, and nowhere else. Keys are validated by the
 * `MediaKey` schema (path-safe, no `..`), so this can't point off the host. https only, except a
 * loopback host for local development.
 */
export function mediaUrl(host: string, key: string): string {
  const scheme = LOOPBACK.test(host) ? 'http' : 'https';
  return `${scheme}://${host}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Up to two initials from a booth name, upper-cased. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : name.slice(0, 2);
  return letters.toUpperCase();
}

export function monogram(name: string, accent: Color): CanvasTexture {
  const canvas = createCanvas(MONOGRAM_PX, MONOGRAM_PX);
  const ctx = context2d(canvas);
  ctx.fillStyle = `#${accent.getHexString()}`;
  ctx.fillRect(0, 0, MONOGRAM_PX, MONOGRAM_PX);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `800 ${MONOGRAM_PX * 0.42}px "Segoe UI", Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials(name), MONOGRAM_PX / 2, MONOGRAM_PX * 0.54);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
