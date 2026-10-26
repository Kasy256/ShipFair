import { describe, expect, it } from 'vitest';
import {
  checkAnimations,
  checkBoothKit,
  checkCharacter,
  checkWardrobeItem,
} from '../lib/checks.ts';
import { boothKit, character, clips, contract } from './fixtures.ts';

const ALL_SLOTS = contract.boothKit.tierSlots;

describe('character naming contract', () => {
  const entry = { hairs: ['hair_01'], accessories: [] };

  it('accepts contract materials, attributes and listed hairs', () => {
    const doc = character(['SKIN', 'TOP', 'BOTTOM', 'SHOES'], { extraNodes: ['hair_01'] });
    expect(checkCharacter(doc, 'body.glb', contract, entry).errors).toEqual([]);
  });

  it('names a wrong material, a missing hair and a missing attribute', () => {
    const doc = character(['SKIN', 'Shirt'], { omit: ['_MASK'] });
    const { errors } = checkCharacter(doc, 'body.glb', contract, entry);
    expect(errors).toContain(
      'body.glb: material "Shirt" isn\'t one of SKIN, TOP, BOTTOM, SHOES, EYES, HAIR, ACCENT',
    );
    expect(errors).toContain('body.glb: no object named hair_01');
    expect(errors).toContain('body.glb: mesh body (Shirt) has no _MASK attribute');
  });
});

describe('animation clips', () => {
  it('passes when every required clip exists', () => {
    const result = checkAnimations(clips(['idle', 'walk']), 'clips.glb', ['idle', 'walk'], {});
    expect(result).toEqual({ errors: [], warnings: [], substitutes: {} });
  });

  it('fails a missing clip without a substitute', () => {
    const { errors } = checkAnimations(clips(['idle']), 'clips.glb', ['idle', 'run'], {});
    expect(errors).toEqual(['clips.glb: clip run is missing (rename the action to exactly "run")']);
  });

  it('warns and records a declared substitute that exists', () => {
    const result = checkAnimations(clips(['idle', 'talk']), 'clips.glb', ['idle', 'emote_wave'], {
      emote_wave: 'talk',
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      'clips.glb: clip emote_wave is missing; playing talk instead',
    ]);
    expect(result.substitutes).toEqual({ emote_wave: 'talk' });
  });

  it('fails when the substitute is missing too', () => {
    const { errors } = checkAnimations(clips(['idle']), 'c.glb', ['emote_wave'], {
      emote_wave: 'talk',
    });
    expect(errors).toEqual([
      'c.glb: clip emote_wave is missing and its substitute talk is missing too',
    ]);
  });
});

describe('booth kit', () => {
  const tiers = ['tier_stall', 'tier_booth', 'tier_pavilion'];

  it('accepts every tier with all its slots', () => {
    const doc = boothKit(ALL_SLOTS);
    expect(checkBoothKit(doc, 'booth_kit.glb', contract, tiers).errors).toEqual([]);
  });

  it('says which tier lacks which slot, and which tier is missing', () => {
    const doc = boothKit({
      tier_stall: ALL_SLOTS.tier_stall ?? [],
      tier_booth: (ALL_SLOTS.tier_booth ?? []).filter((s) => s !== 'SLOT_logo'),
    });
    const { errors } = checkBoothKit(doc, 'booth_kit.glb', contract, tiers);
    expect(errors).toContain('booth_kit.glb: tier_booth has no SLOT_logo');
    expect(errors).toContain(
      'booth_kit.glb: no tier_pavilion empty (each tier is a parent empty named exactly tier_pavilion)',
    );
    expect(errors).toHaveLength(2);
  });
});

describe('wardrobe items', () => {
  const joints = ['root', 'pelvis', 'spine_01'];

  it('accepts a top with region, mask and print UVs on the body skeleton', () => {
    const doc = character(['AVATAR'], { joints });
    expect(checkWardrobeItem(doc, 'tshirt_m.glb', contract, 'top', joints).errors).toEqual([]);
  });

  it('requires _UV_PRINT on tops only', () => {
    const doc = character(['AVATAR'], { joints, omit: ['_UV_PRINT'] });
    expect(checkWardrobeItem(doc, 'tshirt_m.glb', contract, 'top', joints).errors).toEqual([
      'tshirt_m.glb: mesh body (AVATAR) has no _UV_PRINT attribute',
    ]);
    expect(checkWardrobeItem(doc, 'jeans_m.glb', contract, 'bottom', joints).errors).toEqual([]);
  });

  it('rejects a skeleton whose joint order differs from the body', () => {
    const doc = character(['AVATAR'], { joints: ['root', 'spine_01', 'pelvis'] });
    expect(checkWardrobeItem(doc, 'hair.glb', contract, 'hair', joints).errors).toEqual([
      'hair.glb: joints differ from the body skeleton (joint 1: spine_01 vs pelvis)',
    ]);
  });
});
