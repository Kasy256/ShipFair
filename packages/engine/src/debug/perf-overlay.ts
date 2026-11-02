import type { WebGLInfo } from 'three';
import type { Loop, System } from '../core/loop.ts';
import { jsHeapMb, MemoryGraph } from './memory-graph.ts';

const REFRESH_S = 0.25;
const MB = 1024 * 1024;

export type DebugFlag = 'perf' | 'physics';

/** Reads `?debug=perf,physics` (comma separated) into a set of flags. */
export function debugFlags(search: string): ReadonlySet<DebugFlag> {
  const flags = new Set<DebugFlag>();
  for (const value of new URLSearchParams(search).getAll('debug')) {
    for (const part of value.split(',')) {
      if (part === 'perf' || part === 'physics') flags.add(part);
    }
  }
  return flags;
}

/**
 * `?debug=perf`: a small text readout of fps, frame ms, draw calls, triangles, textures,
 * geometries, estimated texture memory and JS heap, over a rolling memory graph (prompt 14). A
 * developer tool, so it is the one bit of DOM the engine draws itself; it is only created behind
 * the flag and updates four times a second.
 */
export class PerfOverlay implements System {
  readonly #el: HTMLDivElement;
  readonly #text: HTMLDivElement;
  readonly #graph = new MemoryGraph();
  readonly #loop: Loop;
  readonly #info: WebGLInfo;
  readonly #renderScale: () => number;
  readonly #textureBytes: () => number;
  #elapsed = 0;
  #frames = 0;
  #frameMsSum = 0;

  constructor(
    parent: HTMLElement,
    loop: Loop,
    info: WebGLInfo,
    renderScale: () => number,
    textureBytes: () => number,
  ) {
    this.#loop = loop;
    this.#info = info;
    this.#renderScale = renderScale;
    this.#textureBytes = textureBytes;
    const el = document.createElement('div');
    el.dataset.testid = 'perf-overlay';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      zIndex: '50',
      padding: '6px 8px',
      font: '12px/1.35 ui-monospace, monospace',
      color: '#e6f4ea',
      background: 'rgba(10, 12, 18, 0.78)',
      borderRadius: '6px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
    });
    this.#text = document.createElement('div');
    el.append(this.#text, this.#graph.canvas);
    parent.appendChild(el);
    this.#el = el;
  }

  update(dt: number): void {
    this.#elapsed += dt;
    this.#frames++;
    this.#frameMsSum += this.#loop.frameMs;
    if (this.#elapsed < REFRESH_S) return;
    const fps = this.#frames / this.#elapsed;
    const ms = this.#frameMsSum / this.#frames;
    const { render, memory } = this.#info;
    const textureMb = this.#textureBytes() / MB;
    const heapMb = jsHeapMb();
    this.#graph.push(textureMb, heapMb);
    this.#text.textContent =
      `${fps.toFixed(0)} fps  ${ms.toFixed(1)} ms\n` +
      `draws ${render.calls}  tris ${render.triangles}\n` +
      `tex ${memory.textures}  geo ${memory.geometries}\n` +
      `texMB ${textureMb.toFixed(1)} (peak ${this.#graph.peakTextureMb.toFixed(1)})\n` +
      `heapMB ${Number.isNaN(heapMb) ? 'n/a' : heapMb.toFixed(0)}\n` +
      `scale ${this.#renderScale().toFixed(2)}`;
    this.#elapsed = 0;
    this.#frames = 0;
    this.#frameMsSum = 0;
  }

  dispose(): void {
    this.#el.remove();
  }
}
