import { BufferAttribute, BufferGeometry } from 'three';

/**
 * A float copy of `names` (quantized, normalized attributes are dequantized) with a uint32 index,
 * so transforms can be baked in and copies from different files merge. Missing attributes are
 * filled with `fill`. Load-time only.
 */
export function floatCopy(
  src: BufferGeometry,
  names: readonly (readonly [name: string, size: number, fill: number])[],
): BufferGeometry {
  const count = src.getAttribute('position').count;
  const out = new BufferGeometry();
  for (const [name, size, fill] of names) {
    const from = src.getAttribute(name) as BufferAttribute | undefined;
    const array = new Float32Array(count * size).fill(fill);
    if (from) {
      for (let i = 0; i < count; i++)
        for (let c = 0; c < size; c++) array[i * size + c] = from.getComponent(i, c);
    }
    out.setAttribute(name, new BufferAttribute(array, size));
  }
  const index = src.getIndex();
  const indices = new Uint32Array(index ? index.count : count);
  for (let i = 0; i < indices.length; i++) indices[i] = index ? index.getX(i) : i;
  out.setIndex(new BufferAttribute(indices, 1));
  return out;
}
