/** Samples kept: one per overlay refresh (0.25 s), so the graph spans 30 s. */
const SAMPLES = 120;
const WIDTH_PX = 120;
const HEIGHT_PX = 40;
/** The y axis never shrinks below this, so a near-empty scene doesn't look alarming. */
const MIN_SCALE_MB = 16;
const TEXTURE_COLOR = '#ffb547';
const HEAP_COLOR = '#7cc7ff';

interface ChromeMemory {
  usedJSHeapSize: number;
}

/** Chromium's non-standard `performance.memory` (MB), or NaN elsewhere. */
export function jsHeapMb(): number {
  const memory = (performance as Performance & { memory?: ChromeMemory }).memory;
  return memory ? memory.usedJSHeapSize / (1024 * 1024) : Number.NaN;
}

/**
 * `?debug=perf`: a rolling graph of estimated texture memory (amber; the texture cache's
 * estimate, since renderer.info has no byte counts) and JS heap (blue, Chromium only). Ring
 * buffers and one 2D canvas: drawing allocates nothing.
 */
export class MemoryGraph {
  readonly canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D | null;
  readonly #texture = new Float32Array(SAMPLES);
  readonly #heap = new Float32Array(SAMPLES);
  #next = 0;
  #count = 0;
  /** The highest texture estimate seen since the page loaded. */
  peakTextureMb = 0;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH_PX;
    canvas.height = HEIGHT_PX;
    canvas.dataset.testid = 'perf-memory-graph';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { display: 'block', marginTop: '4px', width: `${WIDTH_PX}px` });
    this.canvas = canvas;
    this.#ctx = canvas.getContext('2d');
  }

  push(textureMb: number, heapMb: number): void {
    this.#texture[this.#next] = textureMb;
    this.#heap[this.#next] = heapMb;
    this.#next = (this.#next + 1) % SAMPLES;
    this.#count = Math.min(this.#count + 1, SAMPLES);
    if (textureMb > this.peakTextureMb) this.peakTextureMb = textureMb;
    this.#draw();
  }

  #draw(): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    let max = MIN_SCALE_MB;
    for (let i = 0; i < this.#count; i++) {
      max = Math.max(
        max,
        this.#texture[i] ?? 0,
        Number.isNaN(this.#heap[i]) ? 0 : (this.#heap[i] ?? 0),
      );
    }
    ctx.clearRect(0, 0, WIDTH_PX, HEIGHT_PX);
    this.#line(ctx, this.#texture, max, TEXTURE_COLOR);
    this.#line(ctx, this.#heap, max, HEAP_COLOR);
  }

  #line(ctx: CanvasRenderingContext2D, values: Float32Array, max: number, color: string): void {
    ctx.strokeStyle = color;
    ctx.beginPath();
    let hasPoint = false;
    // Oldest first, left to right.
    for (let i = 0; i < this.#count; i++) {
      const value = values[(this.#next - this.#count + i + SAMPLES) % SAMPLES] ?? 0;
      if (Number.isNaN(value)) continue;
      const x = (i / (SAMPLES - 1)) * WIDTH_PX;
      const y = HEIGHT_PX - (value / max) * (HEIGHT_PX - 2) - 1;
      if (hasPoint) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      hasPoint = true;
    }
    ctx.stroke();
  }
}
