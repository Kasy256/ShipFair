import { expect, test } from '@playwright/test';
import { bootCity } from '../engine/city-helpers.ts';
import { report } from '../engine/helpers.ts';

// Prompt 11: "no per-frame allocations in interpolation or posing". The sampling heap profiler
// runs over thousands of remote-player updates (60 fake visitors walking) and counts what was
// allocated under our interpolation, stand-in posing and name tag code. glTF mixers (three's
// AnimationMixer, as for the local player) and LOD swaps (building a new character) are not
// per-frame work of this path and are left out.
//
// What remains (34–46 B a frame for 60 players in 3 runs, under 1 B per player) is V8 boxing doubles passed
// across calls it doesn't inline (`setChild`, `sample`, `NameTags.add`); no objects or arrays are
// created. The bound catches any real regression: one 16-byte object per player per frame is
// already 960 B a frame.

const FRAMES = 2000;
const PLAYERS = 60;
const MAX_BYTES_PER_FRAME = 64;
const OURS = /(remote|posed-stand-ins|name-tags|snapshot-buffer|clock-sync|limb-matrix|pose)\.ts/;
/** Frames whose subtree isn't per-frame interpolation or posing. */
const EXCLUDED = /animator\.ts|#change|GltfAvatar|create@/;

interface ProfileNode {
  callFrame: { functionName: string; url: string };
  selfSize: number;
  children: ProfileNode[];
}

test(`remote players: interpolation and posing stay under ${MAX_BYTES_PER_FRAME} B a frame for ${PLAYERS} players`, async ({
  page,
}) => {
  test.setTimeout(240_000);
  await bootCity(page, 'quality=low', 60);
  await page.evaluate(async (players) => {
    const api = window.__shipfair;
    if (!api) return;
    const p = api.player.position;
    api.net.fake(players, 11, p.x, p.z + 6);
    api.step(1 / 60, 30);
    await api.net.settled();
    api.step(1 / 60, 240); // warm up: let V8 optimise the per-frame code
    await api.net.settled();
  }, PLAYERS);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32 });
  await page.evaluate((frames) => {
    const remotes = window.__shipfair?.engine.runtime?.multiplayer.remotes;
    for (let i = 0; i < frames; i++) remotes?.update(1 / 60);
  }, FRAMES);
  const { profile } = (await cdp.send('HeapProfiler.stopSampling')) as unknown as {
    profile: { head: ProfileNode };
  };

  let bytes = 0;
  const sites = new Map<string, number>();
  const walk = (node: ProfileNode, path: string[], isOurs: boolean) => {
    const name = `${node.callFrame.functionName || '(anonymous)'}@${node.callFrame.url.split('/').pop()?.split('?')[0]}`;
    if (EXCLUDED.test(name)) return;
    const mine = isOurs || OURS.test(node.callFrame.url);
    if (mine && node.selfSize > 0) {
      bytes += node.selfSize;
      const site = [...path, name].slice(-3).join(' < ');
      sites.set(site, (sites.get(site) ?? 0) + node.selfSize);
    }
    for (const child of node.children) walk(child, [...path, name], mine);
  };
  walk(profile.head, [], false);
  const top = [...sites].sort((a, b) => b[1] - a[1]).slice(0, 5);
  report('remote update allocations', {
    frames: FRAMES,
    bytes,
    bytesPerFrame: Number((bytes / FRAMES).toFixed(2)),
    top,
  });
  expect(bytes / FRAMES).toBeLessThan(MAX_BYTES_PER_FRAME);
});
