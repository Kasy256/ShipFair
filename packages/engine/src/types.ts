// Placeholders for the engine's public types. Prompt 02 replaces them with the
// zod-backed types in @shipfair/shared (events, world schemas, quality tiers).
export type QualityTier = 'high' | 'low';
export type EventBus = Readonly<Record<string, unknown>>;
export type WorldSnapshot = Readonly<Record<string, unknown>>;
export type BoothChange = Readonly<Record<string, unknown>>;
export type Teleport = Readonly<Record<string, unknown>>;

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  quality: QualityTier;
  bus: EventBus;
}
