// One function per manifest section: load (or generate a placeholder), check the naming contract,
// build LODs, optimise, measure against the contract budgets and emit content-hashed files.
import type { Document } from '@gltf-transform/core';
import { weld } from '@gltf-transform/functions';
import type {
  AssetSourceManifest,
  BuiltAnimations,
  BuiltBoothKit,
  BuiltCharacter,
  BuiltProp,
} from '@shipfair/shared';
import { checkAnimations, checkBoothKit, checkCharacter, jointNames } from './checks.ts';
import type { Contract } from './contract.ts';
import { boothKitLayout, bounds, clipList, hipHeight, pelvisRestHeight } from './extract.ts';
import { hasHandMadeLod, simplifiedCopy, stripHandMadeLod, useHandMadeLod } from './lod.ts';
import { optimise } from './optimise.ts';
import {
  placeholderAnimations,
  placeholderBoothKit,
  placeholderCharacter,
  placeholderProp,
} from './placeholders.ts';
import { loadSource, type Report, type Sink } from './sink.ts';
import { checkBudget, countTriangles, largestAlternative, measure } from './stats.ts';
import { processTextures } from './textures.ts';

export interface Ctx {
  contract: Contract;
  exportDir: string;
  sink: Sink;
  report: Report;
  usePlaceholders: boolean;
}

/** LOD1 aims a little under budget so rounding and locked borders don't tip it over. */
export const LOD_TARGET_SHARE = 0.95;
/** Above this relative simplification error, LOD1 warns and prefers a hand-made `*_LOD1`. */
export const LOD_MAX_ERROR = 0.02;

/** Adds a check result to the report. */
function record(ctx: Ctx, result: { errors: string[]; warnings: string[] }): void {
  ctx.report.errors.push(...result.errors);
  ctx.report.warnings.push(...result.warnings);
}

async function finish(ctx: Ctx, base: string, doc: Document, kind: Parameters<typeof optimise>[1]) {
  ctx.report.errors.push(...processTextures(doc, base, ctx.contract.materials.palette));
  await optimise(doc, kind);
  return ctx.sink.addGlb(base, doc);
}

export interface CharacterResult {
  built: BuiltCharacter;
  joints: string[];
  /** LOD0 / LOD1 triangles without the alternative hairs (what a v2 avatar's body costs). */
  baseTriangles: { lod0: number; lod1: number };
}

export async function processCharacter(
  ctx: Ctx,
  entry: AssetSourceManifest['characters'][number],
): Promise<CharacterResult> {
  const { contract, report } = ctx;
  const loaded = await loadSource(ctx.exportDir, entry.src, report, ctx.usePlaceholders);
  const isPlaceholder = loaded === null;
  const source = loaded ?? placeholderCharacter(contract);
  const file = entry.src.split('/').pop() ?? entry.src;
  if (!isPlaceholder) record(ctx, checkCharacter(source, file, contract, entry));
  await source.transform(weld());
  const alternatives = [...entry.hairs];
  const lod1Budget = contract.budgets.characterLod1.triangles ?? Number.POSITIVE_INFINITY;
  const ratio = Math.min(
    1,
    (LOD_TARGET_SHARE * lod1Budget) / Math.max(1, countTriangles(source, alternatives)),
  );
  let lod1 = simplifiedCopy(source, ratio);
  // Locked borders between the body's material regions can stall above budget; then unlock them.
  if (countTriangles(lod1.doc, alternatives) > lod1Budget)
    lod1 = simplifiedCopy(source, ratio, false);
  let isHandMade = false;
  const lod1Tris = countTriangles(lod1.doc, alternatives);
  if (lod1Tris > lod1Budget || lod1.error > LOD_MAX_ERROR) {
    const why = `${lod1Tris} triangles, error ${lod1.error.toFixed(4)}`;
    if (hasHandMadeLod(source)) {
      report.warnings.push(`${file}: generated LOD1 is poor (${why}); using the hand-made *_LOD1`);
      lod1 = { doc: useHandMadeLod(source), error: 0 };
      isHandMade = true;
    } else {
      report.warnings.push(
        `${file}: generated LOD1 is poor (${why}); add a *_LOD1 object to fix it`,
      );
    }
  }
  stripHandMadeLod(source);
  const joints = jointNames(source);
  const baseTriangles = {
    lod0: countTriangles(source, alternatives) - largestAlternative(source, alternatives),
    lod1: countTriangles(lod1.doc, alternatives) - largestAlternative(lod1.doc, alternatives),
  };
  const shape = { bounds: bounds(source), hipHeightM: hipHeight(source) };
  const preLod0 = measure(source, 0, alternatives);
  const preLod1 = measure(lod1.doc, 0, alternatives);
  const out0 = await finish(ctx, `characters/${entry.id}`, source, 'skinned');
  const out1 = await finish(ctx, `characters/${entry.id}_lod1`, lod1.doc, 'skinned');
  const stats = checkBudget(
    file,
    { ...preLod0, bytes: out0.bytes },
    contract.budgets.characterLod0,
  );
  const stats1 = checkBudget(
    `${entry.id}_lod1.glb`,
    { ...preLod1, bytes: out1.bytes },
    contract.budgets.characterLod1,
  );
  report.budget.push(...stats.problems, ...stats1.problems);
  return {
    joints,
    baseTriangles,
    built: {
      id: entry.id,
      url: out0.url,
      isPlaceholder,
      stats,
      lod1: { url: out1.url, stats: stats1, error: round4(lod1.error), isHandMade },
      hairs: isPlaceholder ? [] : entry.hairs,
      accessories: isPlaceholder ? [] : entry.accessories,
      ...shape,
    },
  };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

export async function processAnimations(
  ctx: Ctx,
  entry: AssetSourceManifest['animations'],
): Promise<BuiltAnimations> {
  const loaded = await loadSource(ctx.exportDir, entry.src, ctx.report, ctx.usePlaceholders);
  const doc = loaded ?? placeholderAnimations();
  const file = entry.src.split('/').pop() ?? entry.src;
  let substitutes: Record<string, string> = {};
  if (loaded) {
    const result = checkAnimations(doc, file, entry.required, entry.substitutes);
    record(ctx, result);
    substitutes = result.substitutes;
  }
  const clips = clipList(doc);
  const pelvisRestHeightM = pelvisRestHeight(doc);
  const pre = measure(doc, 0);
  const out = await finish(ctx, 'animations/humanoid_clips', doc, 'animation');
  const stats = checkBudget(file, { ...pre, bytes: out.bytes }, ctx.contract.budgets.animationSet);
  ctx.report.budget.push(...stats.problems);
  return { url: out.url, isPlaceholder: !loaded, stats, clips, substitutes, pelvisRestHeightM };
}

export async function processBoothKit(
  ctx: Ctx,
  entry: AssetSourceManifest['boothKit'],
): Promise<BuiltBoothKit> {
  const { contract } = ctx;
  const loaded = await loadSource(ctx.exportDir, entry.src, ctx.report, ctx.usePlaceholders);
  const doc = loaded ?? placeholderBoothKit(contract);
  const file = entry.src.split('/').pop() ?? entry.src;
  if (loaded) record(ctx, checkBoothKit(doc, file, contract, entry.tiers));
  const pre = measure(doc, 0);
  const out = await finish(ctx, 'booth-kit/booth_kit', doc, 'static');
  // After optimising: quantization folds its dequantize transform into the part placements.
  const layout = boothKitLayout(doc, entry.tiers);
  const triangles = layout.parts.reduce((sum, p) => sum + p.triangles, 0);
  const stats = checkBudget(
    file,
    { ...pre, triangles, bytes: out.bytes },
    contract.budgets.boothKit,
  );
  for (const part of layout.parts) {
    const limit = contract.boothKit.parts[part.name];
    if (limit !== undefined && part.triangles > limit) {
      stats.problems.push(
        `${file}: ${part.name} has ${part.triangles} triangles (budget ${limit})`,
      );
      stats.isOverBudget = true;
    }
  }
  ctx.report.budget.push(...stats.problems);
  return { url: out.url, isPlaceholder: !loaded, stats, ...layout };
}

export async function processProp(
  ctx: Ctx,
  entry: AssetSourceManifest['props'][number],
): Promise<BuiltProp> {
  const loaded = await loadSource(ctx.exportDir, entry.src, ctx.report, ctx.usePlaceholders);
  const doc = loaded ?? placeholderProp(entry.id, entry.collider, ctx.contract);
  const file = entry.src.split('/').pop() ?? entry.src;
  const box = bounds(doc);
  const pre = measure(doc, 0);
  const out = await finish(ctx, `props/${entry.id}`, doc, 'static');
  const stats = checkBudget(file, { ...pre, bytes: out.bytes }, ctx.contract.budgets.prop);
  ctx.report.budget.push(...stats.problems);
  return {
    id: entry.id,
    url: out.url,
    isPlaceholder: !loaded,
    stats,
    collider: entry.collider,
    bounds: box,
  };
}
