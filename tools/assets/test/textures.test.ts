import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../lib/png.ts';
import { findToktx, needsKtx2, processTextures, TEXTURE_MAX_PX } from '../lib/textures.ts';

const PALETTE = 'M_Palette';

/** Width and height from a KTX2 header (pixelWidth and pixelHeight, little-endian u32 at 20, 24). */
function ktx2Size(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(20, true), view.getUint32(24, true)];
}

/** A document with one material using a `size`² PNG as its base colour. */
function texturedDoc(material: string, size: number): Document {
  const doc = new Document();
  const rgb = new Uint8Array(size * size * 3).map((_, i) => (i * 37) % 251);
  const texture = doc
    .createTexture('albedo')
    .setImage(encodePng(size, size, rgb))
    .setMimeType('image/png')
    .setURI('albedo.png');
  doc.createMaterial(material).setBaseColorTexture(texture);
  return doc;
}

describe('KTX2 textures (prompt 14)', () => {
  it('only files with non-palette textures need KTX2 (and a low-tier copy)', () => {
    expect(needsKtx2(texturedDoc(PALETTE, 4), PALETTE)).toBe(false);
    expect(needsKtx2(texturedDoc('M_Sign', 4), PALETTE)).toBe(true);
    expect(needsKtx2(new Document(), PALETTE)).toBe(false);
  });

  it('encodes at most 1024 px, or 512 px for the low tier; without toktx the build fails', () => {
    for (const [tier, maxPx] of Object.entries(TEXTURE_MAX_PX)) {
      const doc = texturedDoc('M_Sign', 1100);
      const errors = processTextures(doc, `sign.${tier}`, PALETTE, maxPx);
      const texture = doc.getRoot().listTextures()[0];
      if (!findToktx()) {
        // Never ship the PNG instead: the error names what to install.
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/sign\.\w+: textures albedo need KTX2; install KTX-Software/);
        expect(texture?.getMimeType()).toBe('image/png');
        continue;
      }
      expect(errors).toEqual([]);
      expect(texture?.getMimeType()).toBe('image/ktx2');
      expect(texture?.getURI()).toBe('albedo.ktx2');
      const image = texture?.getImage();
      const [w, h] = image ? ktx2Size(image) : [0, 0];
      expect(Math.max(w, h)).toBe(maxPx);
    }
  });
});
