// Tiny geometry builders for the generated placeholders and the test fixtures.
import type { Document, Material, Primitive } from '@gltf-transform/core';

export interface Attributes {
  positions: number[];
  normals: number[];
  indices: number[];
}

const empty = (): Attributes => ({ positions: [], normals: [], indices: [] });

/** An axis-aligned box (24 vertices, 12 triangles) centred on `c`. */
export function box(size: readonly number[], c: readonly number[] = [0, 0, 0]): Attributes {
  const out = empty();
  const [hx = 0.5, hy = 0.5, hz = 0.5] = size.map((s) => s / 2);
  const [cx = 0, cy = 0, cz = 0] = c;
  // Each face: normal axis, sign, and the two in-plane axes (ordered for CCW winding).
  const faces: [number, number, number, number][] = [
    [0, 1, 1, 2],
    [0, -1, 2, 1],
    [1, 1, 2, 0],
    [1, -1, 0, 2],
    [2, 1, 0, 1],
    [2, -1, 1, 0],
  ];
  const half = [hx, hy, hz];
  const centre = [cx, cy, cz];
  for (const [axis, sign, u, v] of faces) {
    const base = out.positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const p = [0, 0, 0];
      p[axis] = sign * (half[axis] ?? 0);
      p[u] = su * (half[u] ?? 0);
      p[v] = sv * (half[v] ?? 0);
      out.positions.push(...p.map((x, i) => x + (centre[i] ?? 0)));
      const n = [0, 0, 0];
      n[axis] = sign;
      out.normals.push(...n);
    }
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return out;
}

/**
 * A surface of revolution around +Y from a `[radius, y]` profile (bottom to top). Rings
 * `[from, to)` can be cut out with `slice`, so a capsule splits into material regions.
 */
export function lathe(
  profile: readonly (readonly [number, number])[],
  segments: number,
): Attributes {
  const out = empty();
  for (const [r, y] of profile) {
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      out.positions.push(Math.sin(a) * r, y, Math.cos(a) * r);
      const n = [Math.sin(a), 0, Math.cos(a)];
      out.normals.push(...n);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < profile.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * row + s;
      const b = a + row;
      out.indices.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  return out;
}

/** Writes `shape` as a primitive with `material` and optional constant extra attributes. */
export function primitive(
  doc: Document,
  shape: Attributes,
  material: Material,
  extra: Readonly<Record<string, { size: 1 | 2 | 3 | 4; value: readonly number[] }>> = {},
): Primitive {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const count = shape.positions.length / 3;
  const accessor = (
    type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4',
    array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
  ) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(shape.positions)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(shape.normals)))
    .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(count * 2).fill(0.5)))
    .setIndices(accessor('SCALAR', new Uint16Array(shape.indices)));
  const types = { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4' } as const;
  for (const [semantic, { size, value }] of Object.entries(extra)) {
    const data = semantic.startsWith('JOINTS')
      ? new Uint16Array(count * size)
      : new Float32Array(count * size);
    for (let i = 0; i < count; i++) data.set(value, i * size);
    prim.setAttribute(semantic, accessor(types[size], data));
  }
  return prim;
}
