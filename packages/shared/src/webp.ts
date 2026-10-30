// Reads a WebP's pixel size from its first 30 bytes, so the Worker can check an upload's real
// dimensions with a ranged read instead of decoding it. Handles the three bitstream headers:
// VP8 (lossy), VP8L (lossless) and VP8X (extended: alpha, animation, metadata).

/** Bytes needed by `webpSize`. */
export const WEBP_HEADER_BYTES = 30;

export interface WebpSize {
  readonly w: number;
  readonly h: number;
}

const ascii = (b: Uint8Array, at: number, text: string) =>
  [...text].every((ch, i) => b[at + i] === ch.charCodeAt(0));
const u8 = (b: Uint8Array, at: number) => b[at] ?? 0;
const u16 = (b: Uint8Array, at: number) => u8(b, at) | (u8(b, at + 1) << 8);
const u24 = (b: Uint8Array, at: number) => u16(b, at) | (u8(b, at + 2) << 16);

/** The image size, or null when the bytes aren't a WebP header this understands. */
export function webpSize(bytes: Uint8Array): WebpSize | null {
  if (bytes.length < WEBP_HEADER_BYTES || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) {
    return null;
  }
  if (ascii(bytes, 12, 'VP8X')) {
    return { w: u24(bytes, 24) + 1, h: u24(bytes, 27) + 1 };
  }
  if (ascii(bytes, 12, 'VP8L')) {
    if (u8(bytes, 20) !== 0x2f) return null;
    const bits =
      u8(bytes, 21) | (u8(bytes, 22) << 8) | (u8(bytes, 23) << 16) | (u8(bytes, 24) << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(bytes, 12, 'VP8 ')) {
    // Frame tag (3 bytes), then the key-frame start code 9d 01 2a, then 14-bit width and height.
    if (u8(bytes, 23) !== 0x9d || u8(bytes, 24) !== 0x01 || u8(bytes, 25) !== 0x2a) return null;
    return { w: u16(bytes, 26) & 0x3fff, h: u16(bytes, 28) & 0x3fff };
  }
  return null;
}
