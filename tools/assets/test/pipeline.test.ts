import { describe, expect, it } from 'vitest';
import { checkBoothKit, checkCharacter } from '../lib/checks.ts';
import { boothKitLayout } from '../lib/extract.ts';
import { getIO, readGlb, writeGlb } from '../lib/io.ts';
import { simplifiedCopy } from '../lib/lod.ts';
import { optimise } from '../lib/optimise.ts';
import { palettePng } from '../lib/palette.ts';
import { placeholderBoothKit, placeholderCharacter, placeholderProp } from '../lib/placeholders.ts';
import { decodePng } from '../lib/png.ts';
import { lathe, primitive } from '../lib/shapes.ts';
import { countTriangles } from '../lib/stats.ts';
import { validateGlb } from '../lib/validate.ts';
import { contract, newDoc } from './fixtures.ts';

describe('generated placeholders', () => {
  it('are valid glTF and follow the naming contract', async () => {
    const kit = placeholderBoothKit(contract);
    const body = placeholderCharacter(contract);
    for (const [name, doc] of [
      ['kit', kit],
      ['body', body],
      ['prop', placeholderProp('bench_01', 'box', contract)],
    ] as const) {
      expect((await validateGlb(name, await writeGlb(doc))).errors).toEqual([]);
    }
    expect(checkBoothKit(kit, 'kit', contract, contract.boothKit.tiers).errors).toEqual([]);
    expect(checkCharacter(body, 'body', contract, { hairs: [], accessories: [] }).errors).toEqual(
      [],
    );
  });

  it('survive optimisation with every tier, part placement and slot transform intact', async () => {
    await getIO();
    const doc = placeholderBoothKit(contract);
    await optimise(doc, 'static');
    const reread = await readGlb(await writeGlb(doc));
    const layout = boothKitLayout(reread, contract.boothKit.tiers);
    expect(layout.tiers.map((t) => t.id)).toEqual(contract.boothKit.tiers);
    expect(layout.aoAttribute).toBe('COLOR_0');
    const booth = layout.tiers.find((t) => t.id === 'tier_booth');
    expect(booth?.slots.map((s) => s.name).sort()).toEqual(
      [...(contract.boothKit.tierSlots.tier_booth ?? [])].sort(),
    );
    const logo = booth?.slots.find((s) => s.name === 'SLOT_logo');
    expect(logo).toMatchObject({ w: 1.1, h: 1.1 });
    expect(logo?.matrix.slice(12, 15)).toEqual([0, 1.73, -3.55]);
    expect(layout.tiers.find((t) => t.id === 'tier_pavilion')?.lots).toBe(2);
  });
});

describe('LOD1 simplification', () => {
  it('cuts triangles, reports an error metric and keeps custom attributes', async () => {
    await getIO();
    const doc = newDoc();
    const profile = Array.from(
      { length: 40 },
      (_, i) => [0.3 + 0.05 * Math.sin(i / 3), i * 0.05] as const,
    );
    const extra = { _REGION: { size: 1 as const, value: [7] } };
    const mesh = doc
      .createMesh('m')
      .addPrimitive(primitive(doc, lathe(profile, 32), doc.createMaterial('HAIR'), extra));
    doc.getRoot().listScenes()[0]?.addChild(doc.createNode('m').setMesh(mesh));
    const before = countTriangles(doc);
    const lod = simplifiedCopy(doc, 0.25);
    const after = countTriangles(lod.doc);
    expect(countTriangles(doc)).toBe(before); // the source is untouched
    expect(after).toBeLessThanOrEqual(Math.ceil(before * 0.3));
    expect(lod.error).toBeGreaterThan(0);
    expect(lod.error).toBeLessThan(0.1);
    const region = lod.doc.getRoot().listMeshes()[0]?.listPrimitives()[0]?.getAttribute('_REGION');
    expect(region?.getArray()?.every((v) => v === 7)).toBe(true);
  });
});

describe('palette.png', () => {
  it('lays 16 colours out as 4×4 squares, row-major from the top left', () => {
    const hexes = Array.from(
      { length: 16 },
      (_, i) => `#${(i * 16).toString(16).padStart(2, '0')}0000`,
    );
    const { width, height, rgb } = decodePng(palettePng(hexes));
    expect([width, height]).toEqual([256, 256]);
    const red = (x: number, y: number) => rgb[(y * 256 + x) * 3];
    expect(red(10, 10)).toBe(0);
    expect(red(70, 10)).toBe(16);
    expect(red(10, 70)).toBe(64);
    expect(red(250, 250)).toBe(240);
  });
});
