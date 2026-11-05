import { expect, type Page, test } from '@playwright/test';
import type { BoothPublic } from '@shipfair/shared';
import { deleteStaff, newStaff, type Staff, seedBooth } from '../admin/admin-helpers.ts';
import {
  createTestUser,
  deleteTestUser,
  finishOnboarding,
  localSupabase,
  serviceHeaders,
  signIn,
  type TestUser,
  uniqueHandle,
} from '../auth/auth-helpers.ts';
import { DT, report } from '../engine/helpers.ts';
import { openCity } from '../shell/shell-helpers.ts';
import { decide } from '../submit/submit-helpers.ts';

// Prompt 13: the passport (a guest's stamp survives sign-in and shows on /u/:handle) and the
// plaza's Just Launched wall (a newly approved booth shows after one world refresh, and the wall
// only redraws while on screen and in range).
//
// The shard's evidence report is delivered by the test with the service role: the e2e realtime
// server runs against a web stub that doesn't store stats. Shard → Worker → SQL is covered by
// apps/realtime/src/passport.test.ts, apps/web/worker/*.test.ts and supabase/tests/14_*.sql.

test.describe('passport @full', () => {
  test.describe.configure({ mode: 'serial' });

  const DWELL_MS = 10_500;
  const STAMP = 'district:ai-agents';
  let user: TestUser;
  let handle: string;
  let staff: Staff;

  test.beforeAll(async () => {
    user = await createTestUser();
    handle = uniqueHandle('pass');
    await finishOnboarding(user.id, handle);
    staff = await newStaff();
  });

  test.afterAll(async () => {
    if (user) await deleteTestUser(user.id);
    await deleteStaff(staff);
  });

  async function rpc(name: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${localSupabase().url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { ...serviceHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.ok, await res.clone().text()).toBe(true);
    return res.json();
  }

  async function stampsOf(userId: string): Promise<string[]> {
    const res = await fetch(
      `${localSupabase().url}/rest/v1/passport_stamps?user_id=eq.${userId}&select=stamp`,
      { headers: serviceHeaders() },
    );
    return ((await res.json()) as { stamp: string }[]).map((r) => r.stamp);
  }

  /** Puts the player in the middle of a district and steps so the engine notices the zone. */
  async function walkInto(page: Page, slug: string): Promise<void> {
    await page.evaluate(
      ([s, dt]) => {
        const api = window.__shipfair;
        const d = api?.city.districts().find((x) => x.slug === s);
        if (!api || !d) throw new Error(`no district ${s}`);
        api.player.teleport((d.rect.minX + d.rect.maxX) / 2, 0.5, (d.rect.minZ + d.rect.maxZ) / 2);
        api.step(dt, 10);
      },
      [slug, DT] as const,
    );
  }

  test('a guest stamp survives sign-in and shows on /u/:handle', async ({ page }) => {
    test.setTimeout(180_000);
    await openCity(page, '/', 'quality=low&debug=fake60');

    const started = Date.now();
    await walkInto(page, 'ai-agents');
    await expect(page.getByTestId('hud-district')).toHaveText('AI Agents');
    await expect(page.getByTestId('hud-passport')).toContainText('1', { timeout: 20_000 });
    report('district stamp after ms', Date.now() - started);
    expect(Date.now() - started).toBeGreaterThanOrEqual(DWELL_MS - 500);

    // The book shows it stamped.
    await page.keyboard.press('p');
    const book = page.getByTestId('passport-book');
    await expect(book).toBeVisible();
    await expect(book.locator(`[data-stamp="${STAMP}"]`)).toHaveAttribute('data-held', 'true');
    await expect(book.locator('[data-stamp="district:dev-tools"]')).toHaveAttribute(
      'data-held',
      'false',
    );
    await page.keyboard.press('Escape');

    const guestId = await page.evaluate(
      () => (JSON.parse(localStorage.getItem('shipfair:guest') ?? '{}') as { id?: string }).id,
    );
    expect(guestId).toBeTruthy();

    // Sign in: the guest stamps are offered for merge. No shard has reported yet, so it's pending.
    const merged = page.waitForResponse((r) => r.url().endsWith('/api/passport/merge'));
    await signIn(page, user);
    const answer = (await (await merged).json()) as { awarded: string[]; pending: string[] };
    expect(answer).toEqual({ awarded: [], pending: [STAMP] });
    expect(await stampsOf(user.id)).toEqual([]);

    // The shard's minute report for that guest arrives and is routed to the account.
    await rpc('ingest_passport_evidence', {
      evidence: [{ player: `guest:${guestId}`, kind: 'district', key: 'ai-agents' }],
    });
    expect(await stampsOf(user.id)).toEqual([STAMP]);

    // A forged claim straight to the API is not awarded.
    const token = await page.evaluate(async () => {
      const raw = Object.entries(localStorage).find(([k]) => k.includes('auth-token'))?.[1];
      return raw ? (JSON.parse(raw) as { access_token: string }).access_token : null;
    });
    const forged = await page.request.post('/api/passport/stamp', {
      headers: { authorization: `Bearer ${token}` },
      data: { stamps: ['district:weird', 'first:note'] },
    });
    expect(await forged.json()).toEqual({ awarded: [], pending: ['district:weird'] });
    expect(await stampsOf(user.id)).toEqual([STAMP]);

    // The public page: OG meta from the Worker, stamps from Supabase.
    const html = await (await page.request.get(`/u/${handle}`)).text();
    expect(html).toContain('1 stamp collected');
    await page.goto(`/u/${handle}`);
    const passport = page.getByTestId('profile-passport');
    await expect(passport.locator(`[data-stamp="${STAMP}"]`)).toHaveAttribute('data-held', 'true', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('profile-stamp-count')).toHaveText('1 stamp');
  });

  test('the wall shows a newly approved booth after one world refresh', async ({ page }) => {
    test.setTimeout(180_000);
    const booth = await seedBooth(user.id, 'pending');
    await openCity(page);

    // Face the wall from 10 m (it is south of the spawn, facing north) and let it draw.
    const draw = () =>
      page.evaluate((dt) => {
        const api = window.__shipfair;
        api?.step(dt, 2);
        api?.renderOnce();
        return api?.city.wall() ?? { slugs: [], draws: 0 };
      }, DT);
    await page.evaluate(() => window.__shipfair?.player.teleport(0, 0.5, -6, Math.PI));
    const before = await draw();
    expect(before.slugs).not.toContain(booth.slug);

    await decide(page, staff, booth.id, 'approve');
    // One world refresh, as `notice:world_update` triggers it (use-realtime.ts): revalidate the
    // snapshot, upsert the changed booth.
    const refreshed = await page.evaluate(async (id) => {
      const res = await fetch('/api/world', { cache: 'no-cache' });
      const world = (await res.json()) as { booths: BoothPublic[] };
      const row = world.booths.find((b) => b.id === id);
      if (row) window.__shipfair?.city.update([{ type: 'upsert', booth: row }]);
      return row !== undefined;
    }, booth.id);
    expect(refreshed).toBe(true);
    const after = await draw();
    expect(after.slugs[0]).toBe(booth.slug);
    expect(after.draws).toBeGreaterThan(before.draws);
    report('wall draws (before, after refresh)', [before.draws, after.draws]);

    // Out of range, a change marks the wall dirty but costs nothing until the player is back.
    const upsertAgain = (id: string) =>
      page.evaluate(async (boothId) => {
        const world = (await (await fetch('/api/world', { cache: 'no-cache' })).json()) as {
          booths: BoothPublic[];
        };
        const row = world.booths.find((b) => b.id === boothId);
        if (row) window.__shipfair?.city.update([{ type: 'upsert', booth: row }]);
      }, id);
    await page.evaluate(() => window.__shipfair?.player.teleport(0, 0.5, 120, Math.PI));
    await upsertAgain(booth.id);
    for (let i = 0; i < 5; i++) await draw();
    const far = await draw();
    expect(far.draws).toBe(after.draws);
    await page.evaluate(() => window.__shipfair?.player.teleport(0, 0.5, -6, Math.PI));
    const back = await draw();
    expect(back.draws).toBe(after.draws + 1);

    // Interact at the wall: the list opens, and "Go" takes you to the booth.
    await page.evaluate(() => window.__shipfair?.player.teleport(0, 0.5, -13, Math.PI));
    await draw();
    expect(await page.evaluate(() => window.__shipfair?.city.interact())).toBe('wall');
    const sheet = page.getByTestId('launches-sheet');
    await expect(sheet).toBeVisible();
    // The list reads the UI's world store, which the real refresh path updates too; the shortcut
    // above only fed the engine, so take the newest booth the store knows.
    await sheet
      .getByRole('button', { name: /Go to / })
      .first()
      .click();
    await expect(sheet).toBeHidden();
    const at = await page.evaluate((dt) => {
      window.__shipfair?.step(dt, 2);
      const p = window.__shipfair?.player.position;
      return { x: p?.x ?? 0, z: p?.z ?? 0 };
    }, DT);
    expect(Math.hypot(at.x, at.z + 13)).toBeGreaterThan(20);

    // A tier upgrade on the next refresh builds the booth up again.
    const grows = await page.evaluate(async (id) => {
      const world = (await (await fetch('/api/world', { cache: 'no-cache' })).json()) as {
        booths: BoothPublic[];
      };
      const row = world.booths.find((b) => b.id === id);
      if (!row) return -1;
      window.__shipfair?.city.update([{ type: 'upsert', booth: { ...row, tier: 'booth' } }]);
      return window.__shipfair?.city.growing() ?? -1;
    }, booth.id);
    expect(grows).toBeGreaterThan(0);
  });
});
