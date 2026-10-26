import type { Document } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, resample, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

/**
 * Which vertex attributes get quantized. Positions of skinned meshes stay float: avatars merge
 * the body and items from different files into one geometry at runtime, and each file would get
 * its own quantization grid. Application attributes (`_REGION`, `_MASK`, `_UV_PRINT`, `_AO`) are
 * never quantized because the shaders read their raw values.
 */
const QUANTIZE = {
  skinned: /^(NORMAL|TEXCOORD_0|WEIGHTS_0)$/,
  static: /^(POSITION|NORMAL|TEXCOORD_\d|COLOR_0)$/,
  animation: /^$/,
} as const;
export type OptimiseKind = keyof typeof QUANTIZE;

/**
 * dedup → prune → weld → resample → reorder → quantize, then meshopt compression on write.
 * Leaf nodes (`SLOT_*` empties), extras and custom attributes are kept.
 */
export async function optimise(doc: Document, kind: OptimiseKind): Promise<void> {
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }),
    weld(),
    resample(),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: QUANTIZE[kind] }),
  );
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
}
