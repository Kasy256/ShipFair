import { describe, expect, it } from 'vitest';
import { Engine, type EngineOptions } from './index.ts';

// The stub never touches the canvas, so a bare object stands in for it (no DOM needed).
const options = { canvas: {}, quality: 'high', bus: {} } as unknown as EngineOptions;

describe('Engine stub', () => {
  it('rejects start and throws from the unimplemented methods', async () => {
    const engine = new Engine(options);
    await expect(engine.start({})).rejects.toThrow('not implemented');
    expect(() => engine.updateBooths([])).toThrow('not implemented');
    expect(() => engine.teleport({})).toThrow('not implemented');
    expect(() => engine.setInputEnabled(false)).toThrow('not implemented');
    expect(() => engine.setQuality('low')).toThrow('not implemented');
  });

  it('disposes idempotently', () => {
    const engine = new Engine(options);
    engine.dispose();
    engine.dispose();
    expect(engine.isDisposed).toBe(true);
  });
});
