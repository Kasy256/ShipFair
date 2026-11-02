import { describe, expect, it } from 'vitest';
import { usesKtx2 } from './gltf-loader.ts';

/** A minimal .glb: the 12-byte header and a JSON chunk (padded to 4 bytes with spaces). */
function glb(json: object): ArrayBuffer {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, body.length, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(body, 20);
  return out.buffer;
}

describe('usesKtx2', () => {
  it('finds KHR_texture_basisu in the JSON chunk', () => {
    const asset = { asset: { version: '2.0' } };
    expect(usesKtx2(glb({ ...asset, extensionsUsed: ['KHR_texture_basisu'] }))).toBe(true);
    expect(usesKtx2(glb({ ...asset, extensionsUsed: ['EXT_meshopt_compression'] }))).toBe(false);
  });

  it('is false for anything that is not a glb', () => {
    expect(usesKtx2(new ArrayBuffer(8))).toBe(false);
    const text = new TextEncoder().encode('{"KHR_texture_basisu": 1} and some padding');
    expect(usesKtx2(text.buffer)).toBe(false);
  });
});
