import {
  type BoothPublic,
  type District,
  type MakerPublic,
  WORLD_CACHE_MAX_AGE_S,
  WORLD_CACHE_STALE_S,
  WorldSnapshot,
} from '@shipfair/shared';
import type * as z from 'zod';
import {
  BOOTH_PUBLIC_COLUMNS,
  BoothPublicFromRow,
  DistrictFromRow,
  MAKER_COLUMNS,
  MakerFromRow,
} from '../src/lib/db.ts';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';
import { selectAnon } from './supabase.ts';

/** KV key holding the world cache version. `purgeWorld()` bumps it; cache keys include it. */
export const WORLD_VERSION_KEY = 'world:version';
/** PostgREST `in.(…)` lists stay well under URL length limits at this size. */
const MAKER_BATCH = 100;
/** Header on cached copies: when the snapshot was read from Postgres (epoch ms). */
const FETCHED_AT = 'x-world-fetched-at';

export type WorldCacheStatus = 'hit' | 'stale' | 'miss';

export interface WorldBody {
  json: string;
  status: WorldCacheStatus;
}

/** Headers browsers and the CDN see on `/api/world`. */
export const WORLD_CACHE_CONTROL = `public, max-age=${WORLD_CACHE_MAX_AGE_S}, stale-while-revalidate=${WORLD_CACHE_STALE_S}`;

export async function readWorldVersion(kv: KVNamespace): Promise<number> {
  const value = Number(await kv.get(WORLD_VERSION_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Makes every cached snapshot unreachable; the next request reads Postgres. */
export async function bumpWorldVersion(kv: KVNamespace): Promise<number> {
  const next = (await readWorldVersion(kv)) + 1;
  await kv.put(WORLD_VERSION_KEY, String(next));
  return next;
}

/** Parses each row on its own: one bad row is logged and left out instead of emptying the city. */
function parseRows<T>(rows: unknown[], schema: z.ZodType<T>, what: string): T[] {
  const out: T[] = [];
  let dropped = 0;
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else dropped++;
  }
  if (dropped > 0) console.error(`world: dropped ${dropped} invalid ${what} row(s)`);
  return out;
}

async function readMakers(env: Env, booths: readonly BoothPublic[]): Promise<MakerPublic[]> {
  const ids = [...new Set(booths.map((b) => b.ownerId))];
  const batches: Promise<unknown[]>[] = [];
  for (let i = 0; i < ids.length; i += MAKER_BATCH) {
    const list = ids.slice(i, i + MAKER_BATCH).join(',');
    batches.push(
      selectAnon(env, `public_profiles?select=${MAKER_COLUMNS.join(',')}&id=in.(${list})`),
    );
  }
  const rows = (await Promise.all(batches)).flat();
  return parseRows(rows, MakerFromRow, 'maker');
}

/** Reads districts, approved booths and their makers as the anon role, and validates the result. */
export async function readWorldSnapshot(env: Env, version: number): Promise<WorldSnapshot> {
  const [districtRows, boothRows] = await Promise.all([
    selectAnon(env, 'districts?select=id,slug,name,theme,color,sort_order&order=sort_order,id'),
    selectAnon(
      env,
      `booths?select=${BOOTH_PUBLIC_COLUMNS.join(',')}&status=eq.approved&order=approved_at,id`,
    ),
  ]);
  const districts: District[] = parseRows(districtRows, DistrictFromRow, 'district');
  const booths: BoothPublic[] = parseRows(boothRows, BoothPublicFromRow, 'booth');
  const makers = await readMakers(env, booths);
  const parsed = WorldSnapshot.safeParse({
    version,
    generatedAt: new Date().toISOString(),
    districts,
    booths,
    makers,
  });
  if (!parsed.success) {
    throw new AppError('world_unavailable', 503, 'The world snapshot failed validation', {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function refresh(env: Env, cache: Cache, key: string, version: number): Promise<string> {
  const json = JSON.stringify(await readWorldSnapshot(env, version));
  // Kept for max-age + the stale window; `FETCHED_AT` decides when it counts as stale.
  const stored = new Response(json, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `max-age=${WORLD_CACHE_MAX_AGE_S + WORLD_CACHE_STALE_S}`,
      [FETCHED_AT]: String(Date.now()),
    },
  });
  await cache.put(key, stored);
  return json;
}

/**
 * The snapshot JSON through the edge cache, keyed by the KV version. The Cache API ignores
 * `stale-while-revalidate`, so it is done here: a copy older than max-age is still served, and
 * refreshed in the background (`waitUntil`).
 */
export async function cachedWorld(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  origin: string,
): Promise<WorldBody> {
  const version = await readWorldVersion(env.KV);
  const key = `${origin}/api/world?v=${version}`;
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) {
    const ageMs = Date.now() - Number(hit.headers.get(FETCHED_AT));
    const isStale = !(ageMs <= WORLD_CACHE_MAX_AGE_S * 1000);
    if (isStale) {
      ctx.waitUntil(
        refresh(env, cache, key, version).catch((error: unknown) =>
          console.error('world: background refresh failed', error),
        ),
      );
    }
    return { json: await hit.text(), status: isStale ? 'stale' : 'hit' };
  }
  return { json: await refresh(env, cache, key, version), status: 'miss' };
}

/** The snapshot as an object (for `/b/:slug`), or null when it can't be read. */
export async function worldOrNull(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  origin: string,
): Promise<WorldSnapshot | null> {
  try {
    const { json } = await cachedWorld(env, ctx, origin);
    return WorldSnapshot.parse(JSON.parse(json));
  } catch (error) {
    console.error('world: unavailable for a share page', error);
    return null;
  }
}
