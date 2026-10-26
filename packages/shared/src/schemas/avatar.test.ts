import { describe, expect, it } from 'vitest';
import {
  CAP_INCOMPATIBLE_HAIR,
  HAIR_IDS,
  HARMONY_GROUPS,
  HEADWEAR_HIDES_HAIR,
  PALETTE_COUNT,
  SKIN_COUNT,
} from '../generated/wardrobe-ids.ts';
import { rng } from '../rng.ts';
import {
  AvatarStyleV2,
  DEFAULT_AVATAR_STYLE,
  isHairVisible,
  migrateAvatarStyle,
  nearestColor,
  randomAvatarStyle,
  resolveHeadwear,
} from './avatar.ts';

const longest = <T extends string>(ids: readonly T[]): T =>
  ids.reduce((a, b) => (b.length > a.length ? b : a));

describe('migrateAvatarStyle', () => {
  it('turns v1 flat tints into a valid v2 style with defaults', () => {
    const v2 = migrateAvatarStyle({
      skin: '#6b432c',
      top: '#7c5cff',
      bottom: '#2d3039',
      hair: 'bun',
      accessory: 'headphones',
    });
    expect(AvatarStyleV2.parse(v2)).toEqual(v2);
    expect(v2.v).toBe(2);
    expect(v2.skin).toBeGreaterThanOrEqual(7); // a deep tone stays deep
    expect(v2.top.color).toBe(8); // violet
    expect(v2.bottom.color).toBe(3); // charcoal
    expect(v2.hair.item).toBe('bun_top');
    expect(v2.accessory.item).toBe('headphones');
    expect(v2.headwear.item).toBe('none');
  });

  it('moves a v1 cap into the headwear slot and handles {} and garbage', () => {
    expect(migrateAvatarStyle({ accessory: 'cap' }).headwear.item).toBe('cap');
    expect(migrateAvatarStyle({ accessory: 'cap' }).accessory.item).toBe('none');
    expect(migrateAvatarStyle({})).toEqual(migrateAvatarStyle(undefined));
    expect(migrateAvatarStyle('nope')).toEqual(DEFAULT_AVATAR_STYLE);
  });

  it('passes a valid v2 style through', () => {
    const style = { ...DEFAULT_AVATAR_STYLE, skin: 11 };
    expect(migrateAvatarStyle(style)).toEqual(style);
  });

  it('picks the nearest palette colour', () => {
    expect(nearestColor('#000000', ['#ffffff', '#101010'])).toBe(1);
  });
});

describe('AvatarStyleV2', () => {
  it('rejects unknown ids', () => {
    for (const patch of [
      { hair: { item: 'mullet_9000', color: 0 } },
      { top: { ...DEFAULT_AVATAR_STYLE.top, item: 'cape' } },
      { headwear: { ...DEFAULT_AVATAR_STYLE.headwear, item: 'crown' } },
      { body: 'robot' },
    ]) {
      expect(AvatarStyleV2.safeParse({ ...DEFAULT_AVATAR_STYLE, ...patch }).success).toBe(false);
    }
  });

  it('rejects out-of-range colour indices', () => {
    for (const patch of [
      { skin: SKIN_COUNT },
      { skin: -1 },
      { top: { ...DEFAULT_AVATAR_STYLE.top, color: PALETTE_COUNT } },
      { hair: { ...DEFAULT_AVATAR_STYLE.hair, color: 99 } },
      { shoes: { ...DEFAULT_AVATAR_STYLE.shoes, color2: 1.5 } },
    ]) {
      expect(AvatarStyleV2.safeParse({ ...DEFAULT_AVATAR_STYLE, ...patch }).success).toBe(false);
    }
  });

  it('accepts print ids of every shape and rejects others', () => {
    const withPrint = (print: string) => ({
      ...DEFAULT_AVATAR_STYLE,
      top: { ...DEFAULT_AVATAR_STYLE.top, print },
    });
    for (const ok of ['none', 'stripes', 'shipfair', 'booth:my-tool']) {
      expect(AvatarStyleV2.safeParse(withPrint(ok)).success).toBe(true);
    }
    for (const bad of ['booth:', 'booth:UPPER', 'logo', 'booth:a']) {
      expect(AvatarStyleV2.safeParse(withPrint(bad)).success).toBe(false);
    }
  });

  it('keeps the largest valid style under 500 bytes of JSON', () => {
    const style = AvatarStyleV2.parse({
      ...DEFAULT_AVATAR_STYLE,
      skin: 11,
      hair: { item: longest(HAIR_IDS), color: 11 },
      brows: { color: 11 },
      facial: { item: 'beard_short', color: 11 },
      headwear: { item: 'headwrap_simple', color: 15, color2: 15 },
      top: { item: 'longsleeve', color: 15, color2: 15, print: `booth:${'a'.repeat(40)}` },
      bottom: { item: 'joggers', color: 15, color2: 15 },
      shoes: { item: 'sneakers', color: 15, color2: 15 },
      accessory: { item: 'headphones', color: 15 },
    });
    const bytes = new TextEncoder().encode(JSON.stringify(style)).length;
    expect(bytes).toBeLessThanOrEqual(500);
  });
});

describe('headwear rules', () => {
  it('keeps the hair choice under hair-hiding headwear', () => {
    const hijab = HEADWEAR_HIDES_HAIR[0];
    const style = resolveHeadwear({
      ...DEFAULT_AVATAR_STYLE,
      hair: { item: 'box_braids_long', color: 0 },
      headwear: { ...DEFAULT_AVATAR_STYLE.headwear, item: hijab },
    });
    expect(style.headwear.item).toBe(hijab);
    expect(style.hair.item).toBe('box_braids_long');
    expect(isHairVisible(style)).toBe(false);
    expect(isHairVisible({ ...style, headwear: { ...style.headwear, item: 'none' } })).toBe(true);
  });

  it('drops a cap over a cap-incompatible style', () => {
    for (const hair of CAP_INCOMPATIBLE_HAIR) {
      const style = resolveHeadwear({
        ...DEFAULT_AVATAR_STYLE,
        hair: { item: hair, color: 0 },
        headwear: { ...DEFAULT_AVATAR_STYLE.headwear, item: 'cap' },
      });
      expect(style.headwear.item).toBe('none');
      expect(style.hair.item).toBe(hair);
    }
    const ok = {
      ...DEFAULT_AVATAR_STYLE,
      headwear: { ...DEFAULT_AVATAR_STYLE.headwear, item: 'cap' as const },
    };
    expect(resolveHeadwear(ok).headwear.item).toBe('cap');
  });
});

describe('randomAvatarStyle', () => {
  it('is valid and takes every clothing colour from one harmony group', () => {
    const random = rng(42);
    for (let i = 0; i < 300; i++) {
      const s = randomAvatarStyle(random);
      expect(AvatarStyleV2.safeParse(s).success).toBe(true);
      const used = [
        s.top.color,
        s.top.color2,
        s.bottom.color,
        s.bottom.color2,
        s.shoes.color,
        s.shoes.color2,
        s.headwear.color,
        s.headwear.color2,
        s.accessory.color,
      ];
      const fits = HARMONY_GROUPS.some((g) => used.every((c) => c !== undefined && g.includes(c)));
      expect(fits).toBe(true);
      expect(s.brows.color).toBe(s.hair.color);
    }
  });

  it('is deterministic for a seed and never picks locked items', () => {
    expect(randomAvatarStyle(rng(7))).toEqual(randomAvatarStyle(rng(7)));
    const random = rng(9);
    for (let i = 0; i < 200; i++) {
      const s = randomAvatarStyle(
        random,
        HARMONY_GROUPS,
        (id) => id === 'backpack' || id === 'tshirt',
      );
      expect(s.accessory.item).not.toBe('backpack');
      expect(s.top.item).not.toBe('tshirt');
    }
  });
});
