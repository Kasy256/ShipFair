import { expect, type Page, test } from '@playwright/test';
import { fakeLateBooths } from '@shipfair/shared/fake-world';
import { bootCity, serveFakeMedia } from './city-helpers.ts';
import { DT, report } from './helpers.ts';

// Prompt 05: the city built from a 500-booth fake snapshot (`?debug=fake500`).

const BUDGET = { high: { calls: 400, tris: 1_500_000 }, low: { calls: 150, tris: 400_000 } };

interface View {
  name: string;
  /** Player position and facing yaw; the camera looks the same way from behind. */
  at: (d: Districts) => { x: number; z: number; yaw: number };
  pitch: number;
  distance: number;
}
type Districts = Awaited<ReturnType<typeof districts>>;

async function districts(page: Page) {
  return page.evaluate(() => window.__shipfair?.city.districts() ?? []);
}

const along = (d: Districts[number], m: number) => ({
  x: d.entrance.x + d.outward.x * m,
  z: d.entrance.z + d.outward.z * m,
});
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

const VIEWS: View[] = [
  { name: 'plaza spawn', at: () => ({ x: 0, z: 0, yaw: 0 }), pitch: 0.22, distance: 4.6 },
  {
    name: 'AI Agents gate, up the spine',
    at: (d) => ({ ...along(d[0] as Districts[number], 4), yaw: yawOf(0, 1) }),
    pitch: 0.18,
    distance: 6,
  },
  {
    name: 'Dev Tools mid-spine',
    at: (d) => ({ ...along(d[1] as Districts[number], 180), yaw: yawOf(1, 0) }),
    pitch: 0.3,
    distance: 8,
  },
  {
    name: 'Productivity far end, looking back',
    at: (d) => {
      const p = d[2] as Districts[number];
      return {
        x: p.spineEnd.x - p.outward.x * 4,
        z: p.spineEnd.z - p.outward.z * 4,
        yaw: yawOf(-p.outward.x, -p.outward.z),
      };
    },
    pitch: 0.6,
    distance: 10,
  },
];

/** Puts the player at `view`, lets streaming settle, renders, and returns the counters. */
async function measure(
  page: Page,
  view: { x: number; z: number; yaw: number },
  pitch: number,
  distance: number,
) {
  return page.evaluate(
    async ({ v, pitch, distance, dt }) => {
      const api = window.__shipfair;
      if (!api) throw new Error('no test api');
      api.player.teleport(v.x, 0, v.z, v.yaw);
      api.camera.set(v.yaw + Math.PI, pitch, distance);
      for (let i = 0; i < 3; i++) {
        api.step(dt, 20);
        await api.city.settled();
      }
      api.step(dt, 20);
      api.renderOnce(); // compiles shaders and uploads new textures
      return api.renderOnce();
    },
    { v: view, pitch, distance, dt: DT },
  );
}

test.describe('city', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await serveFakeMedia(page);
  });

  for (const tier of ['high', 'low'] as const) {
    test(`budgets at 4 camera positions with 500 booths (${tier})`, async ({ page }) => {
      await bootCity(page, `quality=${tier}`);
      const d = await districts(page);
      const rows: string[] = [];
      for (const view of VIEWS) {
        const counts = await measure(page, view.at(d), view.pitch, view.distance);
        rows.push(`${view.name}: ${counts.calls} calls, ${counts.triangles} tris`);
        report(`${tier} ${view.name}`, counts);
        expect(counts.calls, view.name).toBeLessThanOrEqual(BUDGET[tier].calls);
        expect(counts.triangles, view.name).toBeLessThanOrEqual(BUDGET[tier].tris);
      }
      const stats = await page.evaluate(() => window.__shipfair?.city.stats());
      report(`${tier} stats`, stats);
      expect(stats?.booths).toBe(500);
      console.log(`BUDGETS ${tier}\n${rows.join('\n')}`);
    });
  }

  test('scripted route through all 3 districts: 0 stuck, all entered, cache within limit', async ({
    page,
  }) => {
    test.setTimeout(900_000);
    await bootCity(page, 'quality=low');
    const d = await districts(page);
    const route: { x: number; z: number }[] = [];
    for (const district of d) {
      const plazaSide = along(district, -6);
      const far = {
        x: district.spineEnd.x - district.outward.x * 3,
        z: district.spineEnd.z - district.outward.z * 3,
      };
      route.push(plazaSide, along(district, 0), far);
      route.push(along(district, 0), plazaSide, { x: 0, z: 0 });
    }
    const result = await page.evaluate(
      async ({ route, dt }) => {
        const api = window.__shipfair;
        const input = api?.player.input;
        if (!api || !input) throw new Error('no test api');
        const zones = new Set<number>();
        let stuck = 0;
        let frames = 0;
        let cacheMax = 0;
        let cacheLimit = 0;
        input.isActive = true;
        input.run = true;
        for (const target of route) {
          let windowStart = { ...api.player.position };
          let windowFrames = 0;
          for (let i = 0; i < 6000; i++) {
            const p = api.player.position;
            const dx = target.x - p.x;
            const dz = target.z - p.z;
            if (dx * dx + dz * dz < 1) break;
            // Camera yaw = heading + π makes "forward" point at the target.
            api.camera.set(Math.atan2(dx, dz) + Math.PI, 0.22, 4.6);
            input.moveY = 1;
            api.step(dt);
            frames++;
            const zone = api.city.zone;
            if (zone !== null) zones.add(zone);
            if (++windowFrames === 240) {
              const moved = Math.hypot(p.x - windowStart.x, p.z - windowStart.z);
              if (moved < 1) {
                stuck++;
                api.player.teleport(target.x, 0, target.z);
              }
              windowStart = { ...api.player.position };
              windowFrames = 0;
            }
            if (frames % 300 === 0) {
              await api.city.settled();
              const s = api.city.stats().cache;
              cacheMax = Math.max(cacheMax, s.size, s.maxSeen);
              cacheLimit = s.max;
            }
          }
        }
        input.moveY = 0;
        input.isActive = false;
        const stats = api.city.stats();
        return { stuck, frames, zones: [...zones].sort(), cacheMax, cacheLimit, stats };
      },
      { route, dt: DT },
    );
    report('frames', result.frames);
    report('stuck', result.stuck);
    report('districtsEntered', result.zones);
    report('textureCacheMax', `${result.cacheMax} of ${result.cacheLimit}`);
    report('cache', result.stats.cache);
    expect(result.stuck).toBe(0);
    expect(result.zones).toEqual(d.map((x) => x.id).sort());
    expect(result.cacheMax).toBeLessThanOrEqual(result.cacheLimit);
    expect(result.stats.cache.loads).toBeGreaterThan(0);
  });

  test('updateBooths adds 20 booths: they appear, nothing moves, memory returns after removal', async ({
    page,
  }) => {
    await bootCity(page, 'quality=high');
    const late = fakeLateBooths(20, 1, 500);
    const result = await page.evaluate(
      async ({ late, dt }) => {
        const api = window.__shipfair;
        const info = api?.info;
        if (!api || !info) throw new Error('no test api');
        const memory = () => ({
          geometries: info.memory.geometries,
          textures: info.memory.textures,
        });
        api.step(dt, 20);
        // Two frames: bloom's ping-pong targets are allocated on alternate frames.
        api.renderOnce();
        api.renderOnce();
        const baseline = memory();
        const before = api.city.transforms();
        const drawnBefore = api.city.stats().drawnInstances;
        api.city.update(late.map((booth) => ({ type: 'upsert' as const, booth })));
        api.step(dt, 3);
        // Mid build-up the new booths are smaller than full size.
        const mid = api.city.transforms();
        const midScale = Math.max(
          ...late.map((b) => Math.hypot(...(mid[b.id] ?? [0, 0, 0]).slice(0, 3))),
        );
        api.step(dt, 90); // > 1.2 s
        api.renderOnce();
        const added = memory();
        const after = api.city.transforms();
        const moved = Object.keys(before).filter(
          (id) => (before[id] ?? []).join() !== (after[id] ?? []).join(),
        );
        const appeared = late.filter((b) => {
          const m = after[b.id];
          return (
            m !== undefined && Math.abs(Math.hypot(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0) - 1) < 1e-6
          );
        }).length;
        const stats = api.city.stats();
        api.city.update(late.map((b) => ({ type: 'remove' as const, boothId: b.id })));
        api.step(dt, 10);
        api.renderOnce();
        const removed = memory();
        return {
          baseline,
          added,
          removed,
          moved: moved.length,
          appeared,
          midScale,
          booths: stats.booths,
          drawnBefore,
          drawnAfter: stats.drawnInstances,
          boothsAfterRemoval: api.city.stats().booths,
        };
      },
      { late, dt: DT },
    );
    report('updateBooths', result);
    expect(result.booths).toBe(520);
    expect(result.appeared).toBe(20);
    expect(result.midScale).toBeLessThan(1);
    expect(result.drawnAfter).toBeGreaterThan(result.drawnBefore);
    expect(result.moved).toBe(0);
    expect(result.boothsAfterRemoval).toBe(500);
    expect(result.removed).toEqual(result.baseline);
  });

  test('focus, open, kiosk and teleports', async ({ page }) => {
    await bootCity(page, 'quality=low', 60);
    const result = await page.evaluate((dt) => {
      const api = window.__shipfair;
      if (!api) throw new Error('no test api');
      const slugs = api.city.slugs();
      const [id = '', slug = ''] = Object.entries(slugs)[7] ?? [];
      api.step(dt, 5);
      const onPlaza = api.city.focused;
      // spawnForBooth stands 5 m out in a 6 m street, next to the booth opposite (a known
      // layout quirk, see the PR follow-ups); step 3.5 m toward the booth before checking focus.
      api.city.teleport({ kind: 'booth', slug });
      const p = api.player.position;
      const yaw = api.player.yaw;
      api.player.teleport(p.x + Math.sin(yaw) * 3.5, 0, p.z + Math.cos(yaw) * 3.5, yaw);
      api.step(dt, 5);
      const focused = api.city.focused;
      const opened = api.city.interact();
      api.player.teleport(0, 0, 7.5, 0);
      api.step(dt, 5);
      const kiosk = api.city.interact();
      api.city.teleport({ kind: 'district', slug: 'dev-tools' });
      api.step(dt, 5);
      const zone = api.city.zone;
      return { id, onPlaza, focused, opened, kiosk, zone };
    }, DT);
    report('interaction', result);
    expect(result.onPlaza).toBeNull();
    expect(result.focused).toBe(result.id);
    expect(result.opened).toBe('booth');
    expect(result.kiosk).toBe('kiosk');
    expect(result.zone).toBe(2);
  });

  test('screenshots: plaza, each district, booth close-up (1280×720)', async ({ page }) => {
    await bootCity(page, 'quality=high');
    const d = await districts(page);
    const shots: {
      file: string;
      v: { x: number; z: number; yaw: number };
      pitch: number;
      dist: number;
    }[] = [
      { file: 'city-plaza.png', v: { x: 0, z: -6, yaw: 0 }, pitch: 0.25, dist: 7 },
      ...d.map((district) => ({
        file: `city-${district.slug}.png`,
        // From the ring road, so the district's gate and signpost are in the shot.
        v: { ...along(district, -8), yaw: Math.atan2(district.outward.x, district.outward.z) },
        pitch: 0.3,
        dist: 7,
      })),
    ];
    for (const shot of shots) {
      await measure(page, shot.v, shot.pitch, shot.dist);
      await page.screenshot({ path: `artifacts/${shot.file}` });
    }
    // Close-up of a booth with streamed content.
    const closeUp = await page.evaluate(async (dt) => {
      const api = window.__shipfair;
      if (!api) throw new Error('no test api');
      const slug = Object.values(api.city.slugs())[3] ?? '';
      api.city.teleport({ kind: 'booth', slug });
      const p = api.player.position;
      const yaw = api.player.yaw;
      api.player.teleport(p.x + Math.sin(yaw) * 1.5, 0, p.z + Math.cos(yaw) * 1.5, yaw);
      api.camera.set(yaw + Math.PI, 0.12, 4.2);
      for (let i = 0; i < 4; i++) {
        api.step(dt, 20);
        await api.city.settled();
      }
      api.renderOnce();
      return api.city.stats();
    }, DT);
    await page.evaluate(() => window.__shipfair?.renderOnce());
    await page.screenshot({ path: 'artifacts/city-booth-closeup.png' });
    report('closeUpStats', closeUp);
    expect(closeUp.contentMeshes).toBeGreaterThan(0);
  });
});
