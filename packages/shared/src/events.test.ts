import { describe, expect, it, vi } from 'vitest';
import { createBus, type EngineEvents } from './events.ts';

describe('createBus', () => {
  it('delivers payloads to subscribers of that event only', () => {
    const bus = createBus<EngineEvents>();
    const focus = vi.fn();
    const open = vi.fn();
    bus.on('booth:focus', focus);
    bus.on('booth:open', open);
    bus.emit('booth:focus', { boothId: 'b-1' });
    expect(focus).toHaveBeenCalledWith({ boothId: 'b-1' });
    expect(open).not.toHaveBeenCalled();
  });

  it('supports events without a payload', () => {
    const bus = createBus<EngineEvents>();
    const handler = vi.fn();
    bus.on('ui:open-submit', handler);
    bus.emit('ui:open-submit');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('unsubscribes via the returned function and via off', () => {
    const bus = createBus<EngineEvents>();
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribe = bus.on('emote', a);
    bus.on('emote', b);
    unsubscribe();
    bus.off('emote', b);
    bus.emit('emote', { e: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('runs every handler even if one throws, then rethrows the first error', () => {
    const bus = createBus<EngineEvents>();
    const after = vi.fn();
    bus.on('chat:send', () => {
      throw new Error('first');
    });
    bus.on('chat:send', () => {
      throw new Error('second');
    });
    bus.on('chat:send', after);
    expect(() => bus.emit('chat:send', { text: 'hi' })).toThrow('first');
    expect(after).toHaveBeenCalledOnce();
  });

  it('does nothing when there are no subscribers, and clear removes all', () => {
    const bus = createBus<EngineEvents>();
    expect(() => bus.emit('net:status', { status: 'online', shard: 'w-1' })).not.toThrow();
    const handler = vi.fn();
    bus.on('quality:set', handler);
    bus.clear();
    bus.emit('quality:set', { tier: 'low' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('emit takes a fixed (type, payload) parameter list, so calls allocate no rest array', () => {
    // `(type, ...args)` would have length 1.
    expect(createBus<EngineEvents>().emit.length).toBe(2);
  });

  it('subscribing the same handler twice delivers once', () => {
    const bus = createBus<EngineEvents>();
    const handler = vi.fn();
    bus.on('teleport', handler);
    bus.on('teleport', handler);
    bus.emit('teleport', { kind: 'district', slug: 'dev-tools' });
    expect(handler).toHaveBeenCalledOnce();
  });
});
