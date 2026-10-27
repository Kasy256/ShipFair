import { createBus, type EngineEvents } from '@shipfair/shared';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { type AssetLoader, AssetManager, type LoadedAsset } from './asset-manager.ts';

function fakeLoader(fail: ReadonlySet<string> = new Set()) {
  const geometries: BoxGeometry[] = [];
  const disposed = { count: 0 };
  const loader: AssetLoader & { calls: string[] } = {
    calls: [],
    load: async (url) => {
      loader.calls.push(url);
      if (fail.has(url)) throw new Error('404');
      const geometry = new BoxGeometry();
      geometry.addEventListener('dispose', () => disposed.count++);
      geometries.push(geometry);
      const scene = new Group().add(new Mesh(geometry, new MeshStandardMaterial()));
      return { scene, animations: [] };
    },
  };
  return { loader, geometries, disposed };
}

const placeholder = (): LoadedAsset => ({
  scene: new Group(),
  animations: [],
  isPlaceholder: true,
});

describe('AssetManager', () => {
  it('fetches each id once and counts references', async () => {
    const { loader } = fakeLoader();
    const assets = new AssetManager(createBus<EngineEvents>(), loader);
    const [a, b] = await Promise.all([
      assets.load('x', '/x.glb', placeholder),
      assets.load('x', '/x.glb', placeholder),
    ]);
    expect(a).toBe(b);
    expect(loader.calls).toEqual(['/x.glb']);
    expect(assets.refs('x')).toBe(2);
  });

  it('disposes GPU resources on the last release only', async () => {
    const { loader, geometries } = fakeLoader();
    const assets = new AssetManager(createBus<EngineEvents>(), loader);
    await assets.load('x', '/x.glb', placeholder);
    await assets.load('x', '/x.glb', placeholder);
    const disposed = vi.fn();
    geometries[0]?.addEventListener('dispose', disposed);
    assets.release('x');
    expect(disposed).not.toHaveBeenCalled();
    assets.release('x');
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(assets.refs('x')).toBe(0);
    await assets.load('x', '/x.glb', placeholder); // loads again after a full release
    expect(loader.calls).toHaveLength(2);
  });

  it('returns the placeholder on failure and reports asset:missing once per id', async () => {
    const { loader } = fakeLoader(new Set(['/gone.glb']));
    const bus = createBus<EngineEvents>();
    const missing = vi.fn();
    bus.on('asset:missing', missing);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const assets = new AssetManager(bus, loader);
    const first = await assets.load('gone', '/gone.glb', placeholder);
    assets.release('gone');
    await assets.load('gone', '/gone.glb', placeholder);
    expect(first.isPlaceholder).toBe(true);
    expect(missing).toHaveBeenCalledTimes(1);
    expect(missing).toHaveBeenCalledWith({ id: 'gone', url: '/gone.glb', reason: '404' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect([...assets.missing]).toEqual(['gone']);
    warn.mockRestore();
  });

  it('treats a missing url (no manifest entry) as missing', async () => {
    const { loader } = fakeLoader();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const assets = new AssetManager(createBus<EngineEvents>(), loader);
    expect((await assets.load('kit', null, placeholder)).isPlaceholder).toBe(true);
    expect(loader.calls).toEqual([]);
    warn.mockRestore();
  });

  it('rejects an invalid manifest and keeps going without one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const assets = new AssetManager(createBus<EngineEvents>(), fakeLoader().loader);
    expect(await assets.loadManifest('/m.json', async () => ({ version: 2 }))).toBeNull();
    expect(
      await assets.loadManifest('/m.json', async () => Promise.reject(new Error('offline'))),
    ).toBeNull();
    expect([...assets.missing]).toEqual(['manifest']);
    warn.mockRestore();
  });

  it('disposes an asset that arrives after the manager is disposed', async () => {
    const { loader, disposed } = fakeLoader();
    const assets = new AssetManager(createBus<EngineEvents>(), loader);
    const pending = assets.load('x', '/x.glb', placeholder);
    assets.dispose();
    await pending;
    expect(disposed.count).toBe(1);
  });
});
