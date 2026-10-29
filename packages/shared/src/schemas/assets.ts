import * as z from 'zod';

// Art assets: `art/manifest.json` (what the build reads) and `assets-manifest.generated.json`
// (what the engine reads). Both are external input, so both are parsed with these schemas.

const AssetId = z.string().regex(/^[a-z0-9_]{1,48}$/);
/** A path relative to `art/export/`, never absolute and never climbing out of it. */
const ExportPath = z
  .string()
  .regex(/^[a-z0-9_-]+(\/[a-z0-9_-]+)*\.(glb|json)$/, 'must be a relative path inside art/export');

export const ColliderShape = z.enum(['box', 'cylinder']);
export type ColliderShape = z.infer<typeof ColliderShape>;

/** `art/manifest.json`: which exports the game uses. */
export const AssetSourceManifest = z.object({
  characters: z.array(
    z.object({
      id: AssetId,
      src: ExportPath,
      /** Hair objects inside the body GLB, shown and hidden by name. */
      hairs: z.array(AssetId).default([]),
      accessories: z.array(AssetId).default([]),
    }),
  ),
  animations: z.object({
    src: ExportPath,
    required: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1),
    /**
     * A required clip that isn't exported yet may name a stand-in clip here. The build then warns
     * instead of failing, and the engine plays the stand-in. Remove an entry once the real clip
     * exists.
     */
    substitutes: z.record(z.string(), z.string()).default({}),
  }),
  boothKit: z.object({
    src: ExportPath,
    tiers: z.array(z.string().regex(/^tier_[a-z0-9_]+$/)).min(1),
  }),
  props: z.array(z.object({ id: AssetId, src: ExportPath, collider: ColliderShape })),
  /** Item manifests from prompt 04c (wardrobe, hair, facial, headwear). */
  wardrobe: z.array(ExportPath).default([]),
});
export type AssetSourceManifest = z.infer<typeof AssetSourceManifest>;

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export const Bounds = z.object({ min: Vec3, max: Vec3 });
export type Bounds = z.infer<typeof Bounds>;
/** Column-major 4×4, as three.js `Matrix4.fromArray` reads it. */
const Matrix = z.array(z.number()).length(16);
const Url = z.string().regex(/^\/[\w\-./]+$/);

/** Measured numbers and the budget verdict for one built file. */
export const AssetStats = z.object({
  triangles: z.int().nonnegative(),
  materials: z.int().nonnegative(),
  bytes: z.int().nonnegative(),
  bones: z.int().nonnegative(),
  isOverBudget: z.boolean(),
  problems: z.array(z.string()),
});
export type AssetStats = z.infer<typeof AssetStats>;

const Built = {
  url: Url,
  /** True when the source was missing and the build wrote a generated stand-in. */
  isPlaceholder: z.boolean(),
  stats: AssetStats,
};

export const BuiltCharacter = z.object({
  id: AssetId,
  ...Built,
  lod1: z.object({ url: Url, stats: AssetStats, error: z.number(), isHandMade: z.boolean() }),
  hairs: z.array(z.string()),
  accessories: z.array(z.string()),
  bounds: Bounds,
  /** Rest height of the pelvis bone; hip translation in clips is scaled by this. */
  hipHeightM: z.number(),
});
export type BuiltCharacter = z.infer<typeof BuiltCharacter>;

export const BuiltClip = z.object({ name: z.string(), durationS: z.number().nonnegative() });

export const BuiltAnimations = z.object({
  ...Built,
  clips: z.array(BuiltClip),
  /** Required clip -> the clip played in its place (missing exports, see the source manifest). */
  substitutes: z.record(z.string(), z.string()),
  pelvisRestHeightM: z.number().nullable(),
});
export type BuiltAnimations = z.infer<typeof BuiltAnimations>;

export const BuiltSlot = z.object({
  name: z.string().regex(/^SLOT_[a-z0-9_]+$/),
  matrix: Matrix,
  /** Rectangle size for `rect` slots (logo, screens, sign); 0 for points (spawn, maker). */
  w: z.number(),
  h: z.number(),
});
export type BuiltSlot = z.infer<typeof BuiltSlot>;

export const BuiltTier = z.object({
  id: z.string(),
  lots: z.int().positive(),
  widthM: z.number(),
  depthM: z.number(),
  /** Part placements relative to the tier root (lot centre, ground level, front +Z). */
  parts: z.array(z.object({ part: z.string(), matrix: Matrix })),
  slots: z.array(BuiltSlot),
});
export type BuiltTier = z.infer<typeof BuiltTier>;

export const BuiltBoothKit = z.object({
  ...Built,
  parts: z.array(z.object({ name: z.string(), triangles: z.int().nonnegative() })),
  tiers: z.array(BuiltTier),
  /** Vertex attribute holding baked AO as glTF exported it, or null if there is none. */
  aoAttribute: z.enum(['COLOR_0', '_AO']).nullable(),
});
export type BuiltBoothKit = z.infer<typeof BuiltBoothKit>;

export const BuiltProp = z.object({
  id: AssetId,
  ...Built,
  collider: ColliderShape,
  bounds: Bounds,
});
export type BuiltProp = z.infer<typeof BuiltProp>;

export const WardrobeKind = z.enum([
  'top',
  'bottom',
  'shoes',
  'accessory',
  'hair',
  'facial',
  'headwear',
]);
export type WardrobeKind = z.infer<typeof WardrobeKind>;

/** One 04c item on one body (`<id>_m.glb` / `<id>_f.glb`). */
export const BuiltWardrobeItem = z.object({
  kind: WardrobeKind,
  id: AssetId,
  /** Character id, e.g. `body_superhero_m`. */
  body: AssetId,
  ...Built,
  lod1: z.object({ url: Url, stats: AssetStats, error: z.number() }),
  /** Body mask bits (`_MASK`) this item hides. */
  hides: z.int().nonnegative(),
  /** Hair mask bits a cap or beanie hides. */
  hidesHairMask: z.int().nonnegative(),
});
export type BuiltWardrobeItem = z.infer<typeof BuiltWardrobeItem>;

/**
 * One choosable 04c item for the avatar editor, body-independent. `bald` is here even though it
 * has no file. Hair carries its texture `family` (straight, wavy, curly, coily, protective, or
 * none for bald and buzz cuts) and `length`; other kinds have null.
 */
export const CatalogItem = z.object({
  kind: WardrobeKind,
  id: AssetId,
  name: z.string().min(1).max(48),
  family: z
    .string()
    .regex(/^[a-z]{1,16}$/)
    .nullable(),
  length: z
    .string()
    .regex(/^[a-z]{1,16}$/)
    .nullable(),
  /** Pre-rendered 256 px thumbnail (04c), or null when there is none. */
  thumb: Url.nullable(),
  /** How many colours the editor offers: 0 (none), 1 or 2. */
  colors: z.int().min(0).max(2),
  hasPrint: z.boolean(),
  /** Passport stamp that unlocks it (`stamp:…`), or null when it's open to everyone. */
  unlock: z.string().nullable(),
});
export type CatalogItem = z.infer<typeof CatalogItem>;

/** `apps/web/public/assets/assets-manifest.generated.json`. */
export const GeneratedAssetManifest = z.object({
  version: z.literal(1),
  palette: z.object({ url: Url, hex: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)) }),
  characters: z.array(BuiltCharacter),
  animations: BuiltAnimations,
  boothKit: BuiltBoothKit,
  props: z.array(BuiltProp),
  wardrobe: z.array(BuiltWardrobeItem),
  /** Editor options in manifest order. Empty when built with placeholders. */
  catalog: z.array(CatalogItem).default([]),
});
export type GeneratedAssetManifest = z.infer<typeof GeneratedAssetManifest>;
