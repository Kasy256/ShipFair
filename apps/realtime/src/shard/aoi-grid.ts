// Uniform spatial grid for area-of-interest queries (ARCHITECTURE.md §7). The shard rebuilds it
// every tick from player positions. Cell arrays are kept and reused between ticks, so a rebuild
// allocates nothing once the grid has warmed up.

// Cells per axis either side of the origin. Keys stay small integers (V8 Smis), which makes the
// Map lookups much cheaper than keys past 2^31 would; ±1024 cells of 20 m is ±20 km.
const GRID_OFFSET = 1024;
const GRID_STRIDE = 2 * GRID_OFFSET;
const MAX_CELL = GRID_OFFSET - 1;

export interface GridItem {
  /** Metres. */
  readonly x: number;
  readonly z: number;
}

export class AoiGrid<T extends GridItem> {
  readonly #cellM: number;
  readonly #cells = new Map<number, T[]>();
  /** Cells that hold items this round, so clear() touches only those. */
  readonly #used: T[][] = [];
  /** Occupied cell range this round, so a query never walks empty cells outside it. */
  #minCx = 0;
  #maxCx = -1;
  #minCz = 0;
  #maxCz = -1;

  constructor(cellM: number) {
    if (!(cellM > 0)) throw new RangeError('AoiGrid needs a positive cell size');
    this.#cellM = cellM;
  }

  #cellOf(metres: number): number {
    const cell = Math.floor(metres / this.#cellM);
    return Math.max(-MAX_CELL, Math.min(MAX_CELL, cell));
  }

  clear(): void {
    for (const cell of this.#used) cell.length = 0;
    this.#used.length = 0;
    this.#minCx = 0;
    this.#maxCx = -1;
    this.#minCz = 0;
    this.#maxCz = -1;
  }

  insert(item: T): void {
    const cx = this.#cellOf(item.x);
    const cz = this.#cellOf(item.z);
    if (this.#used.length === 0) {
      this.#minCx = cx;
      this.#maxCx = cx;
      this.#minCz = cz;
      this.#maxCz = cz;
    } else {
      if (cx < this.#minCx) this.#minCx = cx;
      if (cx > this.#maxCx) this.#maxCx = cx;
      if (cz < this.#minCz) this.#minCz = cz;
      if (cz > this.#maxCz) this.#maxCz = cz;
    }
    const key = (cx + GRID_OFFSET) * GRID_STRIDE + (cz + GRID_OFFSET);
    let cell = this.#cells.get(key);
    if (!cell) {
      cell = [];
      this.#cells.set(key, cell);
    }
    if (cell.length === 0) this.#used.push(cell);
    cell.push(item);
  }

  /**
   * Calls `visit` for every item within `radius` metres (horizontal distance, inclusive) of
   * (x, z). Visiting order is by cell, not by distance.
   */
  forEachWithin(x: number, z: number, radius: number, visit: (item: T) => void): void {
    const maxSq = radius * radius;
    const cx0 = Math.max(this.#cellOf(x - radius), this.#minCx);
    const cx1 = Math.min(this.#cellOf(x + radius), this.#maxCx);
    const cz0 = Math.max(this.#cellOf(z - radius), this.#minCz);
    const cz1 = Math.min(this.#cellOf(z + radius), this.#maxCz);
    for (let cx = cx0; cx <= cx1; cx++) {
      const row = (cx + GRID_OFFSET) * GRID_STRIDE + GRID_OFFSET;
      for (let cz = cz0; cz <= cz1; cz++) {
        const cell = this.#cells.get(row + cz);
        if (!cell) continue;
        for (const item of cell) {
          const dx = item.x - x;
          const dz = item.z - z;
          if (dx * dx + dz * dz <= maxSq) visit(item);
        }
      }
    }
  }
}
