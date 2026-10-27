import { describe, expect, it } from 'vitest';
import { AssetSourceManifest, GeneratedAssetManifest } from './assets.ts';

const source = {
  characters: [{ id: 'body_regular_m', src: 'characters/body_regular_m.glb', hairs: ['hair_01'] }],
  animations: { src: 'animations/humanoid_clips.glb', required: ['idle', 'walk'] },
  boothKit: { src: 'booth-kit/booth_kit.glb', tiers: ['tier_stall', 'tier_booth'] },
  props: [{ id: 'bench_01', src: 'props/bench_01.glb', collider: 'box' }],
};

const stats = {
  triangles: 10,
  materials: 1,
  bytes: 100,
  bones: 0,
  isOverBudget: false,
  problems: [],
};
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const generated = {
  version: 1,
  palette: { url: '/assets/palette.0123456789.png', hex: Array(16).fill('#aabbcc') },
  characters: [],
  animations: {
    url: '/assets/animations/humanoid_clips.abc.glb',
    isPlaceholder: true,
    stats,
    clips: [],
    substitutes: {},
    pelvisRestHeightM: null,
  },
  boothKit: {
    url: '/assets/booth-kit/booth_kit.abc.glb',
    isPlaceholder: false,
    stats,
    parts: [{ name: 'kit_floor', triangles: 12 }],
    tiers: [
      {
        id: 'tier_stall',
        lots: 1,
        widthM: 10,
        depthM: 8,
        parts: [{ part: 'kit_floor', matrix: identity }],
        slots: [{ name: 'SLOT_logo', matrix: identity, w: 1.1, h: 1.1 }],
      },
    ],
    aoAttribute: 'COLOR_0',
  },
  props: [],
  wardrobe: [],
};

describe('AssetSourceManifest (art/manifest.json)', () => {
  it('parses the documented shape and fills defaults', () => {
    const parsed = AssetSourceManifest.parse(source);
    expect(parsed.characters[0]?.accessories).toEqual([]);
    expect(parsed.animations.substitutes).toEqual({});
    expect(parsed.wardrobe).toEqual([]);
  });

  it('rejects paths that leave art/export and unknown colliders', () => {
    const climbing = {
      ...source,
      props: [{ id: 'x', src: 'props/../../secret.glb', collider: 'box' }],
    };
    expect(AssetSourceManifest.safeParse(climbing).success).toBe(false);
    const absolute = { ...source, props: [{ id: 'x', src: '/etc/x.glb', collider: 'box' }] };
    expect(AssetSourceManifest.safeParse(absolute).success).toBe(false);
    const sphere = { ...source, props: [{ id: 'x', src: 'props/x.glb', collider: 'sphere' }] };
    expect(AssetSourceManifest.safeParse(sphere).success).toBe(false);
  });

  it('requires tier ids to start with tier_', () => {
    const bad = { ...source, boothKit: { src: 'booth-kit/k.glb', tiers: ['stall'] } };
    expect(AssetSourceManifest.safeParse(bad).success).toBe(false);
  });
});

describe('GeneratedAssetManifest', () => {
  it('parses a build output', () => {
    expect(GeneratedAssetManifest.parse(generated).boothKit.tiers[0]?.slots[0]?.name).toBe(
      'SLOT_logo',
    );
  });

  it('rejects matrices that are not 4×4 and urls that are not site paths', () => {
    const badMatrix = structuredClone(generated);
    badMatrix.boothKit.tiers[0]?.slots[0]?.matrix.pop();
    expect(GeneratedAssetManifest.safeParse(badMatrix).success).toBe(false);
    const badUrl = {
      ...generated,
      palette: { ...generated.palette, url: 'https://evil.example/p.png' },
    };
    expect(GeneratedAssetManifest.safeParse(badUrl).success).toBe(false);
  });
});
