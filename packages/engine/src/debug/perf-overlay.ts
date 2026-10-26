import type { WebGLInfo } from 'three';
import type { Loop, System } from '../core/loop.ts';

const REFRESH_S = 0.25;

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
 * `?debug=perf`: a small text readout of fps, frame ms, draw calls, triangles, textures and
 * geometries. A developer tool, so it is the one bit of DOM the engine draws itself; it is only
 * created behind the flag and writes `textContent` four times a second.
 */
export class PerfOverlay implements System {
  readonly #el: HTMLDivElement;
  readonly #loop: Loop;
  readonly #info: WebGLInfo;
  readonly #renderScale: () => number;
  #elapsed = 0;
  #frames = 0;
  #frameMsSum = 0;

  constructor(parent: HTMLElement, loop: Loop, info: WebGLInfo, renderScale: () => number) {
    this.#loop = loop;
    this.#info = info;
    this.#renderScale = renderScale;
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
    this.#el.textContent =
      `${fps.toFixed(0)} fps  ${ms.toFixed(1)} ms\n` +
      `draws ${render.calls}  tris ${render.triangles}\n` +
      `tex ${memory.textures}  geo ${memory.geometries}\n` +
      `scale ${this.#renderScale().toFixed(2)}`;
    this.#elapsed = 0;
    this.#frames = 0;
    this.#frameMsSum = 0;
  }

  dispose(): void {
    this.#el.remove();
  }
}
