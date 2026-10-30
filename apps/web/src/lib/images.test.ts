import { describe, expect, it } from 'vitest';
import {
  centreCrop,
  type Decoded,
  type ImageDeps,
  ImageError,
  type ImagePlan,
  planImage,
  prepareImageWith,
} from './images.ts';

describe('centreCrop', () => {
  it('cuts the sides of a wide image', () => {
    expect(centreCrop(1000, 500, 1)).toEqual({ sx: 250, sy: 0, sw: 500, sh: 500 });
  });

  it('cuts the top and bottom of a tall image', () => {
    expect(centreCrop(900, 1600, 16 / 9)).toEqual({ sx: 0, sy: 547, sw: 900, sh: 506 });
  });

  it('leaves an image of the right shape alone', () => {
    expect(centreCrop(1920, 1080, 16 / 9)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
  });
});

describe('planImage', () => {
  it('makes logos 512² from a square centre crop', () => {
    expect(planImage('logo', 800, 600)).toEqual({
      crop: { sx: 100, sy: 0, sw: 600, sh: 600 },
      w: 512,
      h: 512,
    });
    // A 300² source is scaled up: the city shows logos at 512.
    expect(planImage('logo', 300, 300)).toMatchObject({ w: 512, h: 512 });
  });

  it('refuses logos under 256² with the rule in the message', () => {
    expect(() => planImage('logo', 1000, 200)).toThrow('Logo must be at least 256×256');
  });

  it('caps screenshots at 1280 wide and crops them to 16:9 by default', () => {
    expect(planImage('screenshot', 2560, 1600)).toMatchObject({ w: 1280, h: 720 });
    expect(planImage('screenshot', 1000, 1000)).toMatchObject({ w: 1000, h: 563 });
  });

  it('keeps a screenshot shape when not cropping, within 1280 on each side', () => {
    expect(planImage('screenshot', 2000, 1500, false)).toMatchObject({ w: 1280, h: 960 });
    expect(planImage('screenshot', 1000, 2000, false)).toMatchObject({ w: 640, h: 1280 });
  });

  it('refuses screenshots under 640 wide', () => {
    expect(() => planImage('screenshot', 600, 400)).toThrow(ImageError);
  });
});

describe('prepareImageWith', () => {
  interface Fake extends Decoded {
    isClosed: boolean;
  }
  const fakeDeps = (w: number, h: number, encoded: (plan: ImagePlan, q: number) => Blob) => {
    const calls: { plan: ImagePlan; quality: number }[] = [];
    const source: Fake = {
      width: w,
      height: h,
      isClosed: false,
      close() {
        this.isClosed = true;
      },
    };
    const deps: ImageDeps<Fake> = {
      decode: async () => source,
      encode: async (_s, plan, quality) => {
        calls.push({ plan, quality });
        return encoded(plan, quality);
      },
    };
    return { deps, calls, source };
  };
  const webp = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/webp' });

  it('outputs WebP at the planned size, with its sha256, and frees the bitmap', async () => {
    const { deps, calls, source } = fakeDeps(1600, 1200, () => webp(1000));
    const out = await prepareImageWith(deps, new Blob(['x']), 'logo');
    expect(out).toMatchObject({ w: 512, h: 512, bytes: 1000 });
    expect(out.blob.type).toBe('image/webp');
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toEqual([
      { plan: { crop: { sx: 200, sy: 0, sw: 1200, sh: 1200 }, w: 512, h: 512 }, quality: 0.85 },
    ]);
    expect(source.isClosed).toBe(true);
  });

  it('lowers the quality until the file fits its limit', async () => {
    const { deps, calls } = fakeDeps(1280, 720, (_p, q) => webp(q > 0.7 ? 700 * 1024 : 500 * 1024));
    const out = await prepareImageWith(deps, new Blob(['x']), 'screenshot');
    expect(calls.map((c) => c.quality)).toEqual([0.85, 0.75, 0.65]);
    expect(out.bytes).toBe(500 * 1024);
  });

  it('rejects inputs over 10 MB before decoding them', async () => {
    const { deps, calls } = fakeDeps(512, 512, () => webp(1));
    const big = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]);
    await expect(prepareImageWith(deps, big, 'logo')).rejects.toMatchObject({ code: 'too_large' });
    expect(calls).toHaveLength(0);
  });

  it('says so when the browser cannot encode WebP (it falls back to PNG)', async () => {
    const { deps, source } = fakeDeps(512, 512, () => new Blob(['x'], { type: 'image/png' }));
    await expect(prepareImageWith(deps, new Blob(['x']), 'logo')).rejects.toMatchObject({
      code: 'webp_unsupported',
    });
    expect(source.isClosed).toBe(true);
  });

  it('reports unreadable files', async () => {
    const deps: ImageDeps<Decoded> = {
      decode: async () => {
        throw new Error('bad');
      },
      encode: async () => webp(1),
    };
    await expect(prepareImageWith(deps, new Blob(['x']), 'logo')).rejects.toMatchObject({
      code: 'unreadable',
    });
  });
});
