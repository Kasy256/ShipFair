import { AvatarStyleV2, DEFAULT_AVATAR_STYLE, HARMONY_GROUPS, UNLOCKS } from '@shipfair/shared';
import { describe, expect, it } from 'vitest';
import { fallbackCatalog, itemsOf } from '../../lib/avatar-catalog.ts';
import {
  followsHair,
  hairFits,
  headwearFits,
  randomise,
  setBody,
  setColor,
  setHair,
  setHairColor,
  setItem,
  setPrint,
} from './style-edits.ts';

const base = DEFAULT_AVATAR_STYLE;

describe('style edits', () => {
  it('keep the style valid and ignore unknown ids', () => {
    expect(setBody(base, 'superhero_f').body).toBe('superhero_f');
    expect(setBody(base, 'robot')).toBe(base);
    expect(setItem(base, 'top', 'hoodie').top.item).toBe('hoodie');
    expect(setItem(base, 'top', 'cape')).toBe(base);
    expect(setColor(base, 'shoes', 'color2', 99)).toBe(base);
    expect(setPrint(base, 'stripes').top.print).toBe('stripes');
    expect(setPrint(base, 'booth:my-booth').top.print).toBe('booth:my-booth');
  });

  it('let brows and facial hair follow the hair colour until unlinked', () => {
    const style = { ...base, brows: { color: 1 }, facial: { item: 'goatee', color: 1 } } as const;
    expect(followsHair(style)).toEqual({ brows: true, facial: true });
    const both = setHairColor(style, 4, { brows: true, facial: true });
    expect([both.hair.color, both.brows.color, both.facial.color]).toEqual([4, 4, 4]);
    const browsOnly = setHairColor(style, 6, { brows: true, facial: false });
    expect([browsOnly.brows.color, browsOnly.facial.color]).toEqual([6, 1]);
  });

  it('refuse headwear that would clip over big hair', () => {
    const afro = setHair(base, 'afro_round');
    expect(headwearFits(afro, 'cap')).toBe(false);
    expect(headwearFits(afro, 'hijab_wrap')).toBe(true);
    expect(headwearFits(base, 'cap')).toBe(true);
    const capped = setItem(base, 'headwear', 'cap');
    expect(hairFits(capped, 'afro_round')).toBe(false);
    expect(hairFits(capped, 'buzz')).toBe(true);
  });

  it('randomise to valid harmony-group looks without locked items', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const style = randomise(seed);
      expect(AvatarStyleV2.safeParse(style).success).toBe(true);
      expect(style.accessory.item in UNLOCKS).toBe(false);
      const group = HARMONY_GROUPS.find((g) => g[0] === style.top.color);
      expect(group).toBeDefined();
    }
  });
});

describe('fallback catalog', () => {
  it('covers every item kind from the generated ids', () => {
    const catalog = fallbackCatalog();
    expect(itemsOf(catalog, 'hair').length).toBe(
      AvatarStyleV2.shape.hair.shape.item.options.length,
    );
    expect(itemsOf(catalog, 'headwear').some((i) => i.id === 'none')).toBe(false);
    expect(catalog.find((i) => i.id === 'backpack')?.unlock).toBe(UNLOCKS.backpack);
    expect(catalog.find((i) => i.id === 'crew_cut')?.name).toBe('Crew cut');
  });

  it('drops catalog entries the style schema does not know', () => {
    const [first] = fallbackCatalog();
    if (!first) throw new Error('empty catalog');
    const catalog = [...fallbackCatalog(), { ...first, id: 'not_a_hair' }];
    expect(itemsOf(catalog, 'hair').some((i) => i.id === 'not_a_hair')).toBe(false);
  });
});
