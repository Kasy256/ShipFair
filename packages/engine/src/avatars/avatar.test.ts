import { DEFAULT_AVATAR_STYLE, HAIR_HEX, PALETTE_HEX, SKIN_HEX } from '@shipfair/shared';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Int8BufferAttribute,
  Uint8BufferAttribute,
} from 'three';
import { describe, expect, it } from 'vitest';
import { COLOR_SLOTS, hiddenMasks, REGION, writeAvatarColors } from './avatar-colors.ts';
import { mergeAvatarParts } from './merge.ts';

const linear = (hex: string) => {
  const c = new Color().setStyle(hex);
  return [c.r, c.g, c.b];
};
const slot = (colors: Float32Array, i: number) => Array.from(colors.slice(i * 3, i * 3 + 3));

describe('avatar colours', () => {
  it('fills every slot from the style palettes, in linear space', () => {
    const style = {
      ...DEFAULT_AVATAR_STYLE,
      skin: 3,
      facial: { item: 'goatee' as const, color: 4 },
    };
    const out = new Float32Array(COLOR_SLOTS * 3);
    writeAvatarColors(style, out);
    const close = (a: number[], b: number[]) => {
      for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i] ?? -1, 5);
    };
    close(slot(out, REGION.SKIN), linear(SKIN_HEX[3]));
    close(slot(out, REGION.TOP), linear(PALETTE_HEX[style.top.color] ?? ''));
    close(slot(out, REGION.HAIR), linear(HAIR_HEX[style.hair.color] ?? ''));
    close(slot(out, REGION.FACIAL), linear(HAIR_HEX[4]));
    close(slot(out, REGION.ACCESSORY), linear(PALETTE_HEX[style.accessory.color] ?? ''));
  });

  it('ORs body zones from garments and hair zones from headwear separately', () => {
    const masks = hiddenMasks([
      { kind: 'top', hides: 1 | 8192, hidesHairMask: 0 },
      { kind: 'bottom', hides: 16 | 32, hidesHairMask: 0 },
      { kind: 'headwear', hides: 0, hidesHairMask: 7 },
    ]);
    expect(masks).toEqual({ body: 1 | 8192 | 16 | 32, hair: 7 });
  });
});

/** A one-triangle part with quantized normals and uint8 joints, like the built files. */
function part(region: number, mask: number, withPrint = false): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute(
    'normal',
    new Int8BufferAttribute(new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]), 3, true),
  );
  g.setAttribute(
    'skinIndex',
    new Uint8BufferAttribute(new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]), 4),
  );
  g.setAttribute('skinWeight', new BufferAttribute(new Float32Array(12).fill(0.25), 4));
  g.setAttribute('_region', new BufferAttribute(new Float32Array(3).fill(region), 1));
  g.setAttribute('_mask', new BufferAttribute(new Float32Array(3).fill(mask), 1));
  if (withPrint) g.setAttribute('_uv_print', new BufferAttribute(new Float32Array(6).fill(0.5), 2));
  g.setIndex([0, 1, 2]);
  return g;
}

describe('mergeAvatarParts', () => {
  it('merges parts with different attribute types into one float geometry', () => {
    const merged = mergeAvatarParts([
      { geometry: part(0, 1) },
      { geometry: part(1, 0, true) },
      { geometry: part(REGION.HAIR, 0), remap: { from: REGION.HAIR, to: REGION.FACIAL } },
      { geometry: part(0, 0), region: REGION.SHOES },
    ]);
    expect(merged.getAttribute('position').count).toBe(12);
    expect(merged.getIndex()?.count).toBe(12);
    expect(Array.from(merged.getIndex()?.array ?? []).slice(3, 6)).toEqual([3, 4, 5]);
    expect(merged.getAttribute('normal').array).toBeInstanceOf(Float32Array);
    expect(merged.getAttribute('normal').getZ(0)).toBeCloseTo(1);
    expect(Array.from(merged.getAttribute('skinIndex').array.slice(0, 5))).toEqual([1, 0, 0, 0, 2]);
    const region = Array.from(merged.getAttribute('_region').array);
    expect(region).toEqual([
      0,
      0,
      0,
      1,
      1,
      1,
      REGION.FACIAL,
      REGION.FACIAL,
      REGION.FACIAL,
      REGION.SHOES,
      REGION.SHOES,
      REGION.SHOES,
    ]);
    const print = merged.getAttribute('_uv_print');
    expect(print.getX(0)).toBe(-1); // no print UV: outside [0,1]
    expect(print.getX(3)).toBe(0.5);
  });
});
