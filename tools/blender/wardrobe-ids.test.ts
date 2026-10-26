import { describe, expect, it } from 'vitest';
import { constArray, type IdsInput, renderWardrobeIds } from './wardrobe-ids.ts';

const palette = (n: number) => ({ colors: Array.from({ length: n }, () => ({ hex: '#AABBCC' })) });

const input = (): IdsInput => ({
  bodies: ['superhero_f', 'superhero_m'],
  wardrobe: {
    items: [
      { id: 'tshirt', slot: 'top' },
      { id: 'jeans', slot: 'bottom' },
      { id: 'boots', slot: 'shoes' },
      { id: 'backpack', slot: 'accessory', unlock: 'stamp:district:all' },
    ],
  },
  hair: { items: [{ id: 'buzz' }, { id: 'afro_large', capIncompatible: true }] },
  facial: { items: [{ id: 'goatee' }] },
  headwear: {
    items: [
      { id: 'hijab_wrap', hidesHair: true },
      { id: 'cap', hidesHair: false, hidesHairMask: 1 },
    ],
  },
  skin: palette(12),
  hairColors: palette(12),
  palette: { ...palette(16), harmonyGroups: [{ id: 'a', colors: [1, 3] }] },
});

describe('renderWardrobeIds', () => {
  it('writes id unions per slot, flags, palette sizes and unlocks', () => {
    const src = renderWardrobeIds(input());
    expect(src).toContain("export const TOP_IDS = ['tshirt'] as const;");
    expect(src).toContain("export const ACCESSORY_IDS = ['backpack'] as const;");
    expect(src).toContain("export const HEADWEAR_HIDES_HAIR = ['hijab_wrap'] as const;");
    expect(src).toContain("export const HEADWEAR_PARTIAL = ['cap'] as const;");
    expect(src).toContain("export const CAP_INCOMPATIBLE_HAIR = ['afro_large'] as const;");
    expect(src).toContain('export const SKIN_COUNT = 12;');
    expect(src).toContain("'#aabbcc'");
    expect(src).toContain("backpack: 'stamp:district:all'");
  });

  it('rejects harmony groups that index past the palette', () => {
    const bad = input();
    bad.palette.harmonyGroups = [{ id: 'x', colors: [1, 16] }];
    expect(() => renderWardrobeIds(bad)).toThrow(/indexes past 16/);
  });

  it('wraps long arrays one item per line, like the formatter', () => {
    expect(constArray('A', ["'x'"])).toBe("export const A = ['x'] as const;");
    const long = constArray(
      'B',
      Array.from({ length: 20 }, (_, i) => `'item_${i}'`),
    );
    expect(long.split('\n')).toHaveLength(22);
    expect(long.endsWith('] as const;')).toBe(true);
  });
});
