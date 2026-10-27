import { Group, type InstancedMesh } from 'three';

interface Entry {
  readonly mesh: InstancedMesh;
  /** Every instance's matrix (16 floats each), as built. */
  readonly matrices: Float32Array;
  /** Every instance's colour (3 floats each), or null without instanceColor. */
  readonly colors: Float32Array | null;
  /** Ground position (x, z) of each instance, for draw-distance culling. */
  readonly positions: Float32Array;
}

/**
 * A group of InstancedMeshes with a draw distance (ARCHITECTURE.md §4 budgets). One instanced
 * mesh spans the whole city, so frustum culling can't drop far booths; `cull` packs the
 * instances within `radius` to the front of each buffer and draws only those. Allocation-free.
 */
export class InstanceSet {
  readonly group = new Group();
  readonly #entries: Entry[] = [];
  #radius = Number.POSITIVE_INFINITY;

  /** Adds a mesh whose instance matrices (and colours) are already written. */
  add(mesh: InstancedMesh, positions: Float32Array): void {
    this.#entries.push({
      mesh,
      matrices: Float32Array.from(mesh.instanceMatrix.array),
      colors: mesh.instanceColor ? Float32Array.from(mesh.instanceColor.array) : null,
      positions,
    });
    this.group.add(mesh);
  }

  get meshes(): readonly InstancedMesh[] {
    return this.#entries.map((e) => e.mesh);
  }

  /** Instances drawn across all meshes after the last cull. */
  get drawn(): number {
    let n = 0;
    for (const e of this.#entries) n += e.mesh.count;
    return n;
  }

  /** Draws only instances within `radius` metres of (x, z). Infinity restores everything. */
  cull(x: number, z: number, radius: number): void {
    if (radius === Number.POSITIVE_INFINITY && this.#radius === radius) return;
    this.#radius = radius;
    const r2 = radius * radius;
    for (const e of this.#entries) {
      const total = e.positions.length / 2;
      const dst = e.mesh.instanceMatrix.array as Float32Array;
      const dstColor = e.mesh.instanceColor?.array as Float32Array | undefined;
      let n = 0;
      for (let i = 0; i < total; i++) {
        const dx = (e.positions[i * 2] ?? 0) - x;
        const dz = (e.positions[i * 2 + 1] ?? 0) - z;
        if (dx * dx + dz * dz > r2) continue;
        // Plain loops: subarray() would allocate a view per instance.
        for (let k = 0; k < 16; k++) dst[n * 16 + k] = e.matrices[i * 16 + k] ?? 0;
        if (dstColor && e.colors) {
          for (let k = 0; k < 3; k++) dstColor[n * 3 + k] = e.colors[i * 3 + k] ?? 0;
        }
        n++;
      }
      e.mesh.count = n;
      e.mesh.instanceMatrix.needsUpdate = true;
      if (e.mesh.instanceColor) e.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Frees per-instance buffers (geometry and materials are shared and owned elsewhere). */
  dispose(): void {
    for (const e of this.#entries) {
      e.mesh.removeFromParent();
      e.mesh.dispose();
    }
    this.#entries.length = 0;
    this.group.removeFromParent();
  }
}
