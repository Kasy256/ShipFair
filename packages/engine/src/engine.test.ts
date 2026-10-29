import { createBus, type EngineEvents } from '@shipfair/shared';
import { describe, expect, it } from 'vitest';
import { Engine, type EngineOptions } from './index.ts';

// These cases never reach start(), so a bare object stands in for the canvas (no DOM needed).
// Starting the engine needs WebGL; that path is covered by e2e/tests/engine.
const options = (): EngineOptions => ({
  canvas: {} as HTMLCanvasElement,
  quality: 'high',
  bus: createBus<EngineEvents>(),
});

describe('Engine', () => {
  it('ignores booth updates and teleports before start', () => {
    const engine = new Engine(options());
    expect(() => engine.updateBooths([])).not.toThrow();
    expect(engine.teleport({ kind: 'booth', slug: 'some-booth' })).toBe(false);
    expect(engine.layout).toBeNull();
  });

  it('accepts frame listeners and reduced motion before start', async () => {
    const engine = new Engine({ ...options(), isReducedMotion: true });
    const views: unknown[] = [];
    engine.onFrame((view) => views.push({ ...view }));
    engine.setReducedMotion(false);
    engine.step(1 / 60, 3);
    expect(views).toEqual([]);
    // No AudioContext in Node: unlocking reports false instead of throwing.
    expect(await engine.unlockAudio()).toBe(false);
  });

  it('validates booth changes', () => {
    const engine = new Engine(options());
    const bad = { type: 'remove', boothId: 'not-a-uuid' } as const;
    expect(() => engine.updateBooths([bad])).toThrow();
  });

  it('remembers input and quality settings made before start', () => {
    const engine = new Engine(options());
    engine.setInputEnabled(false);
    engine.setQuality('low');
    expect(engine.quality).toBe('low');
    expect(engine.runtime).toBeUndefined();
  });

  it('disposes idempotently and never starts afterwards', async () => {
    const engine = new Engine(options());
    engine.dispose();
    engine.dispose();
    expect(engine.isDisposed).toBe(true);
    await engine.start();
    expect(engine.runtime).toBeUndefined();
  });

  it('step and renderOnce are safe before start', () => {
    const engine = new Engine(options());
    engine.step(1 / 60, 10);
    expect(engine.renderOnce()).toEqual({ calls: 0, triangles: 0 });
  });
});
