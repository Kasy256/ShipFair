import { hashString } from '@shipfair/shared';
import { PROP_SETS } from './prop-plan.ts';

/** Procedural ground patterns (world/textures.ts). */
export type GroundPattern = 'pavers' | 'planks' | 'tiles' | 'concrete';

/**
 * How a district looks (ARCHITECTURE.md §4): palette, ground, street furniture, signage and an
 * ambient tint. Booth geometry is shared; themes vary colours, materials and optional kit
 * variants (`<part>_<kitVariant>` parts in booth_kit.glb).
 */
export interface DistrictTheme {
  readonly key: string;
  /** Booth accent colours (ACCENT parts), picked per booth by id hash. */
  readonly accents: readonly number[];
  readonly ground: {
    readonly pattern: GroundPattern;
    readonly color: number;
    readonly roughness: number;
    readonly metalness: number;
    /** Metres covered by one texture repeat. */
    readonly tileM: number;
  };
  /** Prop ids for street decor (from art/manifest.json). */
  readonly furniture: readonly string[];
  readonly signage: {
    /** Sign board background and lettering. Ink above 1 blooms on high. */
    readonly board: number;
    readonly ink: number;
    readonly inkIntensity: number;
  };
  /** Hemisphere light colours while the player is in the district. */
  readonly ambient: { readonly sky: number; readonly ground: number };
  /** Gate pillars and beam. */
  readonly gate: number;
  readonly kitVariant: string | null;
}

const furniture = (key: string): readonly string[] => PROP_SETS[key] ?? PROP_SETS.default ?? [];

export const DEFAULT_THEME: DistrictTheme = {
  key: 'default',
  accents: [0x3d8bff, 0xff6b3d, 0x00c2a8, 0xffc23f, 0xff4fa3, 0x7c5cff],
  ground: { pattern: 'pavers', color: 0xa6a19a, roughness: 0.85, metalness: 0, tileM: 6 },
  furniture: furniture('default'),
  signage: { board: 0x14161f, ink: 0xffffff, inkIntensity: 1 },
  ambient: { sky: 0xdfe6ff, ground: 0x3a3540 },
  gate: 0x3a3f4b,
  kitVariant: null,
};

export const THEMES: Readonly<Record<string, DistrictTheme>> = {
  // Neon nights: violet ground, magenta and cyan accents, glowing signage.
  'ai-agents': {
    key: 'ai-agents',
    accents: [0x7c5cff, 0xb14cff, 0x00e5ff, 0xff3dcb, 0x5b3dff],
    ground: { pattern: 'tiles', color: 0x3a2f63, roughness: 0.35, metalness: 0.25, tileM: 4 },
    furniture: furniture('ai-agents'),
    signage: { board: 0x120b2e, ink: 0xc9b8ff, inkIntensity: 1.8 },
    ambient: { sky: 0xc7b8ff, ground: 0x2a1f4a },
    gate: 0x2a2148,
    kitVariant: 'neon',
  },
  // Workshop: warm wood floors, steel and safety orange.
  'dev-tools': {
    key: 'dev-tools',
    accents: [0xe07b39, 0x9aa4ad, 0xc9963f, 0x4f6d7a, 0xd9482b],
    ground: { pattern: 'planks', color: 0x9c6b43, roughness: 0.7, metalness: 0, tileM: 5 },
    furniture: furniture('dev-tools'),
    signage: { board: 0x2b2420, ink: 0xffd9a8, inkIntensity: 1.1 },
    ambient: { sky: 0xffe2c2, ground: 0x4a3626 },
    gate: 0x59616b,
    kitVariant: 'workshop',
  },
  // Bright and clean: pale concrete, sky blue, mint and coral.
  productivity: {
    key: 'productivity',
    accents: [0x3db2ff, 0x2ed3a0, 0xff7a6b, 0xffc94d, 0x8c7bff],
    ground: { pattern: 'concrete', color: 0xe6e7e3, roughness: 0.6, metalness: 0, tileM: 8 },
    furniture: furniture('productivity'),
    signage: { board: 0xffffff, ink: 0x1b2a3a, inkIntensity: 1 },
    ambient: { sky: 0xf2f8ff, ground: 0x5a5f66 },
    gate: 0xdfe3e8,
    kitVariant: null,
  },
};

export function themeFor(key: string): DistrictTheme {
  return THEMES[key] ?? DEFAULT_THEME;
}

/** A booth's accent colour: deterministic per booth id. */
export function accentFor(theme: DistrictTheme, boothId: string): number {
  return theme.accents[hashString(boothId) % theme.accents.length] ?? 0xffffff;
}
