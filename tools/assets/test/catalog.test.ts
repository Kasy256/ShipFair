import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCatalog, headwearColors } from '../lib/catalog.ts';
import type { Ctx } from '../lib/kinds.ts';
import { newReport, Sink } from '../lib/sink.ts';
import { contract } from './fixtures.ts';

const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const write = (path: string, data: unknown) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), typeof data === 'string' ? data : JSON.stringify(data));
};

write('export/hair/manifest.json', {
  items: [
    { id: 'bald', name: 'Bald', family: 'none', length: 'bald', thumb: 'hair/thumbs/bald.png' },
    { id: 'afro_round', name: 'Afro', family: 'coily', length: 'medium', thumb: null },
  ],
});
write('export/hair/thumbs/bald.png', 'png-bytes');
write('export/wardrobe/manifest.json', {
  items: [
    { id: 'tshirt', slot: 'top', colorSlots: ['TOP', 'TOP2'], hasPrint: true },
    { id: 'backpack', slot: 'accessory', colorSlots: ['ACCESSORY'], unlock: 'stamp:x' },
  ],
});
write('export/headwear/manifest.json', {
  items: [
    { id: 'kufi', name: 'Kufi', thumb: 'headwear/thumbs/kufi.png' },
    { id: 'gele', name: 'Gele' },
  ],
});
write('config/hair.json', {
  headwear: [
    { id: 'kufi', region: 'ACCENT', parts: [] },
    { id: 'gele', region: 'ACCENT', parts: [{ band: { region: 'ACCENT2' } }] },
  ],
});

const ctx = (): Ctx => ({
  contract,
  exportDir: join(dir, 'export'),
  sink: new Sink(),
  report: newReport(),
  usePlaceholders: false,
});

describe('buildCatalog', () => {
  const manifests = ['hair/manifest.json', 'wardrobe/manifest.json', 'headwear/manifest.json'];

  it('lists every item once with names, hair texture and colour counts', () => {
    const c = ctx();
    const catalog = buildCatalog(c, manifests, headwearColors(dir));
    expect(catalog.map((i) => `${i.kind}:${i.id}`)).toEqual([
      'hair:bald',
      'hair:afro_round',
      'top:tshirt',
      'accessory:backpack',
      'headwear:kufi',
      'headwear:gele',
    ]);
    const byId = new Map(catalog.map((i) => [i.id, i]));
    expect(byId.get('afro_round')).toMatchObject({ family: 'coily', length: 'medium', colors: 1 });
    expect(byId.get('tshirt')).toMatchObject({ name: 'Tshirt', colors: 2, hasPrint: true });
    expect(byId.get('tshirt')?.family).toBeNull();
    expect(byId.get('backpack')).toMatchObject({ colors: 1, unlock: 'stamp:x' });
    expect(byId.get('gele')?.colors).toBe(2);
    expect(byId.get('kufi')?.colors).toBe(1);
  });

  it('copies thumbnails content-hashed and warns about missing ones', () => {
    const c = ctx();
    const catalog = buildCatalog(c, manifests, new Map());
    expect(catalog[0]?.thumb).toMatch(/^\/assets\/thumbs\/hair_bald\.[0-9a-f]+\.png$/);
    expect(catalog.find((i) => i.id === 'kufi')?.thumb).toBeNull();
    expect(c.report.warnings.some((w) => w.includes('kufi.png'))).toBe(true);
    expect(c.sink.files.size).toBe(1);
  });

  it('is empty for a placeholder build', () => {
    expect(buildCatalog({ ...ctx(), usePlaceholders: true }, manifests, new Map())).toEqual([]);
  });
});
