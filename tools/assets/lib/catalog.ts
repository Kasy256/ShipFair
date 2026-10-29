// The avatar editor's option list (prompt 07): every 04c item once, with its display name, hair
// texture and length, colour count, unlock and thumbnail. Thumbnails are copied (content-hashed)
// from art/export/<kind>/thumbs; the editor never hard-codes items.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogItem, WardrobeKind } from '@shipfair/shared';
import * as z from 'zod';
import type { Ctx } from './kinds.ts';

const ItemManifest = z.object({
  items: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9_]{1,48}$/),
      name: z.string().min(1).max(48).optional(),
      slot: z.enum(['top', 'bottom', 'shoes', 'accessory']).optional(),
      family: z.string().nullable().optional(),
      length: z.string().nullable().optional(),
      thumb: z
        .string()
        .regex(/^[a-z0-9_-]+\/thumbs\/[a-z0-9_]+\.png$/)
        .nullable()
        .optional(),
      colorSlots: z.array(z.string()).optional(),
      hasPrint: z.boolean().optional(),
      unlock: z.string().nullable().optional(),
    }),
  ),
});

/** Headwear colour count from art/config/hair.json: 2 when any part uses the ACCENT2 region. */
export function headwearColors(artDir: string): Map<string, number> {
  const file = join(artDir, 'config', 'hair.json');
  if (!existsSync(file)) return new Map();
  const parsed = z
    .object({ headwear: z.array(z.looseObject({ id: z.string() })).optional() })
    .safeParse(JSON.parse(readFileSync(file, 'utf8')));
  const entries = parsed.success ? (parsed.data.headwear ?? []) : [];
  return new Map(entries.map((e) => [e.id, JSON.stringify(e).includes('"ACCENT2"') ? 2 : 1]));
}

/** `tshirt` -> `Tshirt`, for wardrobe items whose manifest has no name. */
const titleCase = (id: string) => id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function buildCatalog(
  ctx: Ctx,
  manifests: readonly string[],
  headwear: ReadonlyMap<string, number>,
): CatalogItem[] {
  if (ctx.usePlaceholders) return [];
  const catalog: CatalogItem[] = [];
  for (const path of manifests) {
    const file = join(ctx.exportDir, path);
    if (!existsSync(file)) continue; // processWardrobe already warns
    const parsed = ItemManifest.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) continue; // and reports the parse error
    const dir = path.split('/')[0] ?? '';
    for (const item of parsed.data.items) {
      const kind: WardrobeKind =
        item.slot ?? (dir === 'facial' || dir === 'headwear' ? dir : 'hair');
      let thumb: string | null = null;
      if (item.thumb) {
        const source = join(ctx.exportDir, item.thumb);
        if (existsSync(source)) {
          thumb = ctx.sink.add(`thumbs/${kind}_${item.id}`, 'png', readFileSync(source));
        } else {
          ctx.report.warnings.push(`${item.thumb}: thumbnail missing; the editor shows the name`);
        }
      }
      const colors =
        kind === 'headwear'
          ? (headwear.get(item.id) ?? 1)
          : kind === 'hair' || kind === 'facial'
            ? 1
            : Math.min(2, item.colorSlots?.length ?? 1);
      catalog.push({
        kind,
        id: item.id,
        name: item.name ?? titleCase(item.id),
        family: kind === 'hair' ? (item.family ?? null) : null,
        length: kind === 'hair' ? (item.length ?? null) : null,
        thumb,
        colors,
        hasPrint: item.hasPrint ?? false,
        unlock: item.unlock ?? null,
      });
    }
  }
  return catalog;
}
