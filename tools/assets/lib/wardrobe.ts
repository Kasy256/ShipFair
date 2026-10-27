// 04c items (garments, accessories, hair, facial hair, headwear) on each body. LOD1 is built per
// item here, at build time; the engine merges LOD1 items the same way it merges LOD0 ones (see
// ARCHITECTURE.md §4 for the measurements behind that choice).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '@gltf-transform/core';
import { weld } from '@gltf-transform/functions';
import type { Bounds, BuiltWardrobeItem, WardrobeKind } from '@shipfair/shared';
import * as z from 'zod';
import { checkWardrobeItem } from './checks.ts';
import type { Contract } from './contract.ts';
import { type Ctx, LOD_MAX_ERROR, LOD_TARGET_SHARE } from './kinds.ts';
import { simplifiedCopy } from './lod.ts';
import { optimise } from './optimise.ts';
import { loadSource } from './sink.ts';
import { checkBudget, countTriangles, measure } from './stats.ts';

const ItemManifest = z.object({
  items: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9_]{1,48}$/),
      slot: z.enum(['top', 'bottom', 'shoes', 'accessory']).optional(),
      files: z.record(z.string(), z.string().nullable()),
      hides: z.int().nonnegative().default(0),
      hidesHairMask: z.int().nonnegative().default(0),
    }),
  ),
});

/** Ids with `longBudget` in art/config/hair.json (long braids and locs get the larger budget). */
export function longHairIds(artDir: string): Set<string> {
  const file = join(artDir, 'config', 'hair.json');
  if (!existsSync(file)) return new Set();
  const parsed = z
    .object({
      hair: z.array(z.object({ id: z.string(), longBudget: z.boolean().optional() })).optional(),
    })
    .safeParse(JSON.parse(readFileSync(file, 'utf8')));
  const styles = parsed.success ? (parsed.data.hair ?? []) : [];
  return new Set(styles.filter((s) => s.longBudget).map((s) => s.id));
}

export function itemBudget(
  contract: Contract,
  kind: WardrobeKind,
  id: string,
  longIds: ReadonlySet<string>,
): number {
  const b = contract.avatar.budgets;
  if (kind === 'hair') return longIds.has(id) ? b.hairLong : b.hair;
  if (kind === 'top' || kind === 'bottom' || kind === 'shoes') return b.garment;
  return b[kind];
}

interface Pending {
  kind: WardrobeKind;
  id: string;
  body: string;
  file: string;
  doc: Document;
  hides: number;
  hidesHairMask: number;
  triangles: number;
}

export interface BodyInfo {
  joints: string[];
  baseTriangles: { lod0: number; lod1: number };
  built: { bounds: Bounds };
}

/** Largest extent of the body: item LOD errors are reported relative to the wearer, not the item. */
const bodySize = (info: BodyInfo | undefined): number | undefined => {
  if (!info) return undefined;
  const { min, max } = info.built.bounds;
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || undefined;
};

const SLOTS: readonly WardrobeKind[] = [
  'top',
  'bottom',
  'shoes',
  'hair',
  'facial',
  'headwear',
  'accessory',
];

/** Largest item per slot, summed: the worst-case outfit's triangles on top of the body. */
export function worstOutfit(items: readonly { kind: WardrobeKind; triangles: number }[]): number {
  return SLOTS.reduce(
    (sum, slot) =>
      sum + Math.max(0, ...items.filter((i) => i.kind === slot).map((i) => i.triangles)),
    0,
  );
}

export async function processWardrobe(
  ctx: Ctx,
  manifests: readonly string[],
  bodies: ReadonlyMap<string, BodyInfo>,
  longIds: ReadonlySet<string>,
): Promise<BuiltWardrobeItem[]> {
  const { contract, report } = ctx;
  const pending: Pending[] = [];
  for (const path of manifests) {
    const file = join(ctx.exportDir, path);
    if (ctx.usePlaceholders || !existsSync(file)) {
      if (!ctx.usePlaceholders)
        report.warnings.push(`${path}: not exported yet; avatars use bodies only`);
      continue;
    }
    const parsed = ItemManifest.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) {
      report.errors.push(`${path}: ${z.prettifyError(parsed.error)}`);
      continue;
    }
    const dir = path.split('/')[0] ?? '';
    for (const item of parsed.data.items) {
      const kind: WardrobeKind =
        item.slot ?? (dir === 'facial' || dir === 'headwear' ? dir : 'hair');
      for (const [body, src] of Object.entries(item.files)) {
        const info = bodies.get(body);
        if (!src || !info) continue;
        const doc = await loadSource(ctx.exportDir, src, report, false);
        if (!doc) continue;
        const name = src.split('/').pop() ?? src;
        const result = checkWardrobeItem(doc, name, contract, kind, info.joints);
        report.errors.push(...result.errors);
        await doc.transform(weld());
        const triangles = countTriangles(doc);
        pending.push({
          kind,
          id: item.id,
          body,
          file: name,
          doc,
          hides: item.hides,
          hidesHairMask: item.hidesHairMask,
          triangles,
        });
      }
    }
  }

  const ratios = new Map<string, number>();
  for (const [body, info] of bodies) {
    const items = pending.filter((p) => p.body === body);
    if (items.length === 0) continue;
    const worst = worstOutfit(items);
    const lod0 = info.baseTriangles.lod0 + worst;
    const room = LOD_TARGET_SHARE * contract.avatar.budgets.avatarLod1 - info.baseTriangles.lod1;
    const ratio = Math.min(1, Math.max(0.1, room / Math.max(1, worst)));
    ratios.set(body, ratio);
    const b = contract.avatar.budgets;
    if (lod0 > b.avatarLod0)
      report.budget.push(
        `${body}: worst-case avatar LOD0 is ${lod0} triangles (budget ${b.avatarLod0})`,
      );
    report.info.push(
      `${body}: worst-case avatar LOD0 ${lod0} triangles; items simplified to ${(ratio * 100).toFixed(0)}% for LOD1`,
    );
  }

  const built: BuiltWardrobeItem[] = [];
  const errors: number[] = [];
  const lod1ByBody = new Map<string, { kind: WardrobeKind; triangles: number }[]>();
  for (const p of pending) {
    const base = `wardrobe/${p.body}/${p.kind}_${p.id}`;
    const lod1 = simplifiedCopy(p.doc, ratios.get(p.body) ?? 1, bodySize(bodies.get(p.body)));
    errors.push(lod1.error);
    const pre1 = measure(lod1.doc, 0);
    const pre0 = measure(p.doc, 0);
    await optimise(p.doc, 'skinned');
    await optimise(lod1.doc, 'skinned');
    const out0 = await ctx.sink.addGlb(base, p.doc);
    const out1 = await ctx.sink.addGlb(`${base}_lod1`, lod1.doc);
    const limit = { triangles: itemBudget(contract, p.kind, p.id, longIds), materials: 1 };
    const stats = checkBudget(p.file, { ...pre0, bytes: out0.bytes }, limit);
    const stats1 = checkBudget(`${p.file} LOD1`, { ...pre1, bytes: out1.bytes }, {});
    report.budget.push(...stats.problems);
    lod1ByBody.set(p.body, [
      ...(lod1ByBody.get(p.body) ?? []),
      { kind: p.kind, triangles: pre1.triangles },
    ]);
    built.push({
      kind: p.kind,
      id: p.id,
      body: p.body,
      url: out0.url,
      isPlaceholder: false,
      stats,
      lod1: { url: out1.url, stats: stats1, error: Math.round(lod1.error * 1e4) / 1e4 },
      hides: p.hides,
      hidesHairMask: p.hidesHairMask,
    });
  }
  if (errors.length > 0) {
    errors.sort((a, b) => a - b);
    const median = errors[Math.floor(errors.length / 2)] ?? 0;
    const poor = errors.filter((e) => e > LOD_MAX_ERROR).length;
    report.info.push(
      `item LOD1 error: median ${median.toFixed(4)}, max ${(errors.at(-1) ?? 0).toFixed(4)}, ${poor} of ${errors.length} above ${LOD_MAX_ERROR}`,
    );
  }
  for (const [body, items] of lod1ByBody) {
    const total = (bodies.get(body)?.baseTriangles.lod1 ?? 0) + worstOutfit(items);
    const limit = contract.avatar.budgets.avatarLod1;
    if (total > limit)
      report.budget.push(`${body}: worst-case avatar LOD1 is ${total} triangles (budget ${limit})`);
    else report.info.push(`${body}: worst-case avatar LOD1 ${total} triangles`);
  }
  return built;
}
