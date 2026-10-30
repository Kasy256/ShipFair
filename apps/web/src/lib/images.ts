import {
  LOGO_MIN_PX,
  LOGO_PX,
  SCREENSHOT_MAX_W_PX,
  SCREENSHOT_MIN_W_PX,
  UPLOAD_INPUT_MAX_B,
  UPLOAD_MAX_B,
  type UploadKind,
  WEBP_QUALITY,
} from '@shipfair/shared';

// Booth images are prepared in the browser (prompt 08): decode, centre-crop, resize, re-encode to
// WebP. Re-encoding drops EXIF and every other metadata block, so nothing about the maker's
// camera or location is uploaded. The server only ever sees small WebP files.

export type ImageErrorCode =
  | 'too_large'
  | 'unreadable'
  | 'too_small'
  | 'webp_unsupported'
  | 'too_large_after';

export class ImageError extends Error {
  readonly code: ImageErrorCode;

  constructor(code: ImageErrorCode, message: string) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
  }
}

export interface Crop {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

export interface ImagePlan {
  readonly crop: Crop;
  readonly w: number;
  readonly h: number;
}

const SCREENSHOT_ASPECT = 16 / 9;
/** Quality steps tried until the file fits its upload limit. */
const QUALITY_STEPS = [WEBP_QUALITY, 0.75, 0.65] as const;

/** The largest centred rectangle of `aspect` (w / h) inside a `w`×`h` image, in whole pixels. */
export function centreCrop(w: number, h: number, aspect: number): Crop {
  if (w / h > aspect) {
    const sw = Math.round(h * aspect);
    return { sx: Math.floor((w - sw) / 2), sy: 0, sw, sh: h };
  }
  const sh = Math.round(w / aspect);
  return { sx: 0, sy: Math.floor((h - sh) / 2), sw: w, sh };
}

/**
 * Crop and output size for an image of `w`×`h`. Logos are square 512²; screenshots keep their
 * shape (or are cut to 16:9 when `isCropped`) and are at most 1280 wide. Throws `too_small` with
 * the rule the image breaks.
 */
export function planImage(kind: UploadKind, w: number, h: number, isCropped = true): ImagePlan {
  if (kind === 'logo') {
    const crop = centreCrop(w, h, 1);
    if (crop.sw < LOGO_MIN_PX) {
      throw new ImageError('too_small', `Logo must be at least ${LOGO_MIN_PX}×${LOGO_MIN_PX}`);
    }
    return { crop, w: LOGO_PX, h: LOGO_PX };
  }
  const crop = isCropped ? centreCrop(w, h, SCREENSHOT_ASPECT) : { sx: 0, sy: 0, sw: w, sh: h };
  if (crop.sw < SCREENSHOT_MIN_W_PX) {
    throw new ImageError(
      'too_small',
      `Screenshots must be at least ${SCREENSHOT_MIN_W_PX} px wide`,
    );
  }
  const scale = Math.min(1, SCREENSHOT_MAX_W_PX / crop.sw, SCREENSHOT_MAX_W_PX / crop.sh);
  return { crop, w: Math.round(crop.sw * scale), h: Math.round(crop.sh * scale) };
}

/** Decoded pixels the encoder can draw (an ImageBitmap in the browser). */
export interface Decoded {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface ImageDeps<D extends Decoded> {
  decode(file: Blob): Promise<D>;
  encode(source: D, plan: ImagePlan, quality: number): Promise<Blob>;
}

export interface PreparedImage {
  readonly blob: Blob;
  readonly w: number;
  readonly h: number;
  readonly bytes: number;
  /** Lowercase hex; it names the uploaded object. */
  readonly sha256: string;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pure pipeline over injectable decode/encode (the browser's below; fakes in tests). */
export async function prepareImageWith<D extends Decoded>(
  deps: ImageDeps<D>,
  file: Blob,
  kind: UploadKind,
  isCropped = true,
): Promise<PreparedImage> {
  if (file.size > UPLOAD_INPUT_MAX_B) {
    throw new ImageError('too_large', 'Pick an image under 10 MB');
  }
  let source: D;
  try {
    source = await deps.decode(file);
  } catch {
    throw new ImageError('unreadable', "That file isn't an image we can read; try a PNG or JPEG");
  }
  try {
    const plan = planImage(kind, source.width, source.height, isCropped);
    for (const quality of QUALITY_STEPS) {
      const blob = await deps.encode(source, plan, quality);
      if (blob.type !== 'image/webp') {
        throw new ImageError(
          'webp_unsupported',
          "This browser can't save WebP images. Try a recent Chrome, Edge or Firefox.",
        );
      }
      if (blob.size <= UPLOAD_MAX_B[kind]) {
        return { blob, w: plan.w, h: plan.h, bytes: blob.size, sha256: await sha256Hex(blob) };
      }
    }
    throw new ImageError(
      'too_large_after',
      'That image has too much detail to fit; try a simpler one',
    );
  } finally {
    source.close();
  }
}

type Canvas2d = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function draw(ctx: Canvas2d, source: ImageBitmap, { crop, w, h }: ImagePlan): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
}

/** The browser's decoder and encoder: OffscreenCanvas when there is one, else a <canvas>. */
export const browserImageDeps: ImageDeps<ImageBitmap> = {
  decode: (file) => createImageBitmap(file),
  async encode(source, plan, quality) {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(plan.w, plan.h);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        draw(ctx, source, plan);
        return canvas.convertToBlob({ type: 'image/webp', quality });
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = plan.w;
    canvas.height = plan.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageError('unreadable', 'Your browser could not draw the image');
    draw(ctx, source, plan);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
        'image/webp',
        quality,
      ),
    );
  },
};

/** Decodes, crops, resizes and re-encodes a picked file for upload. */
export function prepareImage(file: Blob, kind: UploadKind, isCropped = true) {
  return prepareImageWith(browserImageDeps, file, kind, isCropped);
}
