import {
  ASSET_MANIFEST_URL,
  AvatarStyleV2,
  type CatalogItem,
  GeneratedAssetManifest,
  UNLOCKS,
  type WardrobeKind,
} from '@shipfair/shared';
import * as z from 'zod';

/** Only the editor's part of the generated manifest is parsed here; the engine reads the rest. */
const CatalogFile = GeneratedAssetManifest.pick({ catalog: true });

const titleCase = (id: string) => id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const shape = AvatarStyleV2.shape;
const IDS: Record<WardrobeKind, readonly string[]> = {
  hair: shape.hair.shape.item.options,
  facial: shape.facial.shape.item.options.filter((id) => id !== 'none'),
  headwear: shape.headwear.shape.item.options.filter((id) => id !== 'none'),
  top: shape.top.shape.item.options,
  bottom: shape.bottom.shape.item.options,
  shoes: shape.shoes.shape.item.options,
  accessory: shape.accessory.shape.item.options.filter((id) => id !== 'none'),
};

/**
 * Without built art (`pnpm assets:build` not run, or placeholders) the editor still works from
 * the generated ids (`pnpm art:ids`), with names made from the ids and no thumbnails.
 */
export function fallbackCatalog(): CatalogItem[] {
  return (Object.keys(IDS) as WardrobeKind[]).flatMap((kind) =>
    IDS[kind].map(
      (id): CatalogItem => ({
        kind,
        id,
        name: titleCase(id),
        family: null,
        length: null,
        thumb: null,
        colors: kind === 'hair' || kind === 'facial' || kind === 'accessory' ? 1 : 2,
        hasPrint: kind === 'top',
        unlock: UNLOCKS[id] ?? null,
      }),
    ),
  );
}

/** Editor options from the generated manifest, or the fallback when there are none. */
export async function fetchAvatarCatalog(
  fetchJson: (url: string) => Promise<unknown> = async (url) => (await fetch(url)).json(),
): Promise<CatalogItem[]> {
  try {
    const parsed = CatalogFile.safeParse(await fetchJson(ASSET_MANIFEST_URL));
    if (parsed.success && parsed.data.catalog.length > 0) return parsed.data.catalog;
    if (!parsed.success) console.warn('Asset manifest is invalid', z.prettifyError(parsed.error));
  } catch (error) {
    console.warn('No asset manifest; the avatar editor uses generated ids', error);
  }
  return fallbackCatalog();
}

/** Items of one kind, keeping only ids the style schema accepts (a stale manifest can't break it). */
export function itemsOf(catalog: readonly CatalogItem[], kind: WardrobeKind): CatalogItem[] {
  const known = new Set(IDS[kind]);
  return catalog.filter((item) => item.kind === kind && known.has(item.id));
}
