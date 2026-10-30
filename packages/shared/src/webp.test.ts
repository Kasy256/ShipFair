import { describe, expect, it } from 'vitest';
import { webpSize } from './webp.ts';

/** A 30-byte RIFF/WEBP header with `chunk` at offset 12 and `body` from offset 20. */
function header(chunk: string, body: number[]): Uint8Array {
  const b = new Uint8Array(30);
  b.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  );
  b.set(
    [...'WEBP'].map((c) => c.charCodeAt(0)),
    8,
  );
  b.set(
    [...chunk].map((c) => c.charCodeAt(0)),
    12,
  );
  b.set(body, 20);
  return b;
}

describe('webpSize', () => {
  it('reads a lossy (VP8) header', () => {
    // frame tag, start code, width 1280, height 720 (14-bit little endian)
    const b = header('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x05, 0xd0, 0x02]);
    expect(webpSize(b)).toEqual({ w: 1280, h: 720 });
  });

  it('reads a lossless (VP8L) header', () => {
    const w = 512;
    const h = 256;
    const bits = (w - 1) | ((h - 1) << 14);
    const b = header('VP8L', [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      bits >>> 24,
    ]);
    expect(webpSize(b)).toEqual({ w: 512, h: 256 });
  });

  it('reads an extended (VP8X) header', () => {
    // flags (4 bytes), then width-1 and height-1 as 24-bit little endian
    const b = header('VP8X', [0x10, 0, 0, 0, 0xff, 0x01, 0, 0xff, 0x01, 0]);
    expect(webpSize(b)).toEqual({ w: 512, h: 512 });
  });

  it('rejects anything else', () => {
    expect(webpSize(new Uint8Array(10))).toBeNull();
    expect(webpSize(header('VP8 ', [0, 0, 0, 1, 2, 3]))).toBeNull();
    expect(webpSize(header('VP8L', [0]))).toBeNull();
    const png = new Uint8Array(30);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    expect(webpSize(png)).toBeNull();
  });
});
