import type { BoothChange, EngineOptions, QualityTier, Teleport, WorldSnapshot } from './types.ts';

/** Public surface of the 3D runtime (ARCHITECTURE.md §3). A stub until prompt 04. */
export class Engine {
  readonly #options: EngineOptions;
  #isDisposed = false;

  constructor(options: EngineOptions) {
    this.#options = options;
  }

  get canvas(): HTMLCanvasElement {
    return this.#options.canvas;
  }

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  start(_world: WorldSnapshot): Promise<void> {
    return Promise.reject(notImplemented('start'));
  }

  updateBooths(_changes: BoothChange[]): void {
    throw notImplemented('updateBooths');
  }

  teleport(_to: Teleport): void {
    throw notImplemented('teleport');
  }

  setInputEnabled(_enabled: boolean): void {
    throw notImplemented('setInputEnabled');
  }

  setQuality(_tier: QualityTier): void {
    throw notImplemented('setQuality');
  }

  dispose(): void {
    this.#isDisposed = true;
  }
}

function notImplemented(method: string): Error {
  return new Error(`Engine.${method}: not implemented`);
}
