import { describe, expect, it, vi } from 'vitest';
import { type DecodedImage, TextureCache } from './texture-cache.ts';

function fakeSource() {
  const closed: string[] = [];
  const pending = new Map<string, (image: DecodedImage) => void>();
  const load = vi.fn(
    (url: string) =>
      new Promise<DecodedImage>((resolve) => {
        pending.set(url, resolve);
      }),
  );
  const finish = (url: string) =>
    pending.get(url)?.({ width: 64, height: 32, close: () => closed.push(url) });
  return { load, finish, closed, pending };
}

describe('TextureCache', () => {
  it('never holds more than max entries, loading ones included', async () => {
    const { load, finish } = fakeSource();
    const cache = new TextureCache(2, load);
    cache.beginPass();
    expect(cache.request('a', 512)).toBeNull();
    expect(cache.request('b', 512)).toBeNull();
    expect(cache.request('c', 512)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
    finish('a');
    finish('b');
    await cache.settled();
    expect(cache.request('a', 512)).not.toBeNull();
    expect(cache.maxSeen).toBe(2);
  });

  it('evicts the least recently used entry not wanted this pass, and disposes it', async () => {
    const { load, finish, closed } = fakeSource();
    const cache = new TextureCache(2, load);
    cache.beginPass();
    cache.request('a', 512);
    cache.request('b', 512);
    finish('a');
    finish('b');
    await cache.settled();
    const a = cache.request('a', 512);
    const disposed = vi.fn();
    a?.addEventListener('dispose', disposed);
    cache.beginPass();
    cache.touch('b');
    cache.request('c', 512); // 'a' was not asked for this pass: it goes
    expect(closed).toEqual(['a']);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(cache.evictions).toBe(1);
    expect(cache.size).toBe(2);
  });

  it('keeps everything asked for this pass, so a full cache refuses new loads', async () => {
    const { load, finish } = fakeSource();
    const cache = new TextureCache(1, load);
    cache.beginPass();
    cache.request('a', 512);
    finish('a');
    await cache.settled();
    cache.beginPass();
    expect(cache.request('a', 512)).not.toBeNull();
    expect(cache.request('b', 512)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('remembers failures and does not retry them', async () => {
    const load = vi.fn(() => Promise.reject(new Error('404')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cache = new TextureCache(4, load);
    cache.beginPass();
    cache.request('x', 512);
    await cache.settled();
    cache.request('x', 512);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.failures).toBe(1);
    expect(cache.size).toBe(0);
    warn.mockRestore();
  });

  it('shrinks to a lower max and estimates bytes', async () => {
    const { load, finish } = fakeSource();
    const cache = new TextureCache(3, load);
    cache.beginPass();
    for (const url of ['a', 'b', 'c']) cache.request(url, 512);
    for (const url of ['a', 'b', 'c']) finish(url);
    await cache.settled();
    expect(cache.bytes).toBeCloseTo(3 * 64 * 32 * 4 * 1.33);
    cache.setMax(1);
    expect(cache.size).toBe(1);
  });

  it('closes images that finish after dispose', async () => {
    const { load, finish, closed } = fakeSource();
    const cache = new TextureCache(2, load);
    cache.beginPass();
    cache.request('a', 512);
    cache.dispose();
    finish('a');
    await cache.settled();
    expect(closed).toEqual(['a']);
  });
});
