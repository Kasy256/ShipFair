import { deflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';
import { enterWorld } from './helpers.ts';

/** Must match apps/web/src/lib/world-source.ts (the fake world's media host). */
export const FAKE_MEDIA_HOST = 'fake-media.shipfair.test';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A w × h RGB PNG: diagonal stripes in a colour derived from `seed`. */
export function stripedPng(w: number, h: number, seed: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const r = (seed * 97) % 256;
  const g = (seed * 57 + 80) % 256;
  const b = (seed * 31 + 160) % 256;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const on = Math.floor((x + y) / 24) % 2 === 0;
      const i = row + 1 + x * 3;
      raw[i] = on ? r : 240;
      raw[i + 1] = on ? g : 240;
      raw[i + 2] = on ? b : 245;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Serves the fake world's logos and screenshots (with CORS, as R2 would). Returns a hit counter. */
export async function serveFakeMedia(page: Page): Promise<{ requests: number }> {
  const stats = { requests: 0 };
  const cache = new Map<string, Buffer>();
  await page.route(`https://${FAKE_MEDIA_HOST}/**`, async (route) => {
    stats.requests++;
    const url = route.request().url();
    let body = cache.get(url);
    if (!body) {
      const n = Number(/(\d+)\.png$/.exec(url)?.[1] ?? 0);
      body = url.includes('/logo-') ? stripedPng(256, 256, n + 1) : stripedPng(1280, 720, n + 20);
      cache.set(url, body);
    }
    await route.fulfill({
      status: 200,
      body,
      headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' },
    });
  });
  return stats;
}

/** Opens `?debug=fakeN` in test mode and waits until the art and the booths are built. */
export async function bootCity(page: Page, query: string, booths = 500): Promise<void> {
  await page.goto(`/?test&debug=fake${booths}&${query}`);
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-status', 'ready', {
    timeout: 60_000,
  });
  await page.waitForFunction(() => window.__shipfair !== undefined);
  await enterWorld(page);
  await page.evaluate(() => window.__shipfair?.assets.ready());
  await page.waitForFunction(() => window.__shipfair?.city.hasBooths === true);
}
