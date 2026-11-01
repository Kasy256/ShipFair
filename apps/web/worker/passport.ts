import {
  BoothTier,
  MergeRequest,
  PassportAnswer,
  type StampKey,
  StampRequest,
  Uuid,
} from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';
import { serviceDb } from './service.ts';
import { bumpWorldVersion } from './world.ts';

// Passport stamps (prompt 13, ARCHITECTURE.md §7 "Passport trust model"). The browser only asks;
// SQL awards what evidence backs: shard reports for districts, booth visits and realtime facts,
// the user's own rows for first upvote and first note. Nothing a request says is taken as proof.

const HeldStamps = z.array(z.string());

/**
 * Stamps a shard's next report can still back (it reports once a minute). First upvote and first
 * note are checked against the user's rows, so if they aren't held now they won't be.
 */
const isRealtimeBacked = (stamp: StampKey) => stamp !== 'first:upvote' && stamp !== 'first:note';

function badRequest(error: z.ZodError): AppError {
  return new AppError('bad_request', 400, z.prettifyError(error));
}

/** `POST /api/passport/stamp`: awards the claims evidence backs; the rest may be pending. */
export async function claimStamps(
  env: Env,
  userId: string,
  body: unknown,
): Promise<PassportAnswer> {
  const parsed = StampRequest.safeParse(body);
  if (!parsed.success) throw badRequest(parsed.error);
  const claims = [...new Set(parsed.data.stamps)];
  const held = HeldStamps.parse(await serviceDb(env).rpc('award_stamps', { uid: userId, claims }));
  const awarded = claims.filter((s) => held.includes(s));
  const pending = claims.filter((s) => !held.includes(s) && isRealtimeBacked(s));
  return { awarded, pending };
}

/** `POST /api/passport/merge`: a guest's stamps after sign-in, checked against the guest's evidence. */
export async function mergeGuestPassport(
  env: Env,
  userId: string,
  body: unknown,
): Promise<PassportAnswer> {
  const parsed = MergeRequest.safeParse(body);
  if (!parsed.success) throw badRequest(parsed.error);
  const claims = [...new Set(parsed.data.stamps)];
  const answer = PassportAnswer.parse(
    await serviceDb(env).rpc('merge_guest_passport', {
      uid: userId,
      guest: parsed.data.guestId,
      claims,
    }),
  );
  // Only shard-backed stamps can still arrive for a guest; anything else was a guess.
  return { awarded: answer.awarded, pending: answer.pending.filter(isRealtimeBacked) };
}

const TierChange = z.object({ booth_id: Uuid, old_tier: BoothTier, new_tier: BoothTier });
const TIER_RANK = { stall: 0, booth: 1, pavilion: 2 } as const;

export interface NightlyResult {
  changed: string[];
  prunedEvidence: number;
  worldVersion: number | null;
}

/**
 * The nightly cron (03:00 UTC): `recompute_booth_tiers()` in SQL decides, this only triggers it,
 * then bumps the world version and tells the shards so clients rebuild the changed booths.
 */
export async function runNightly(env: Env): Promise<NightlyResult> {
  const db = serviceDb(env);
  const rows = z.array(TierChange).parse(await db.rpc('recompute_booth_tiers', {}));
  const pruned = await db.rpc('prune_passport_evidence', {});
  const changed = rows.map((r) => r.booth_id);
  let worldVersion: number | null = null;
  if (changed.length > 0) {
    worldVersion = await bumpWorldVersion(env.KV);
    try {
      await env.REALTIME.worldUpdate(changed);
    } catch (error) {
      // Clients still get the new tiers on their next world load.
      console.error('nightly: worldUpdate failed', error);
    }
  }
  const result = {
    changed,
    prunedEvidence: typeof pruned === 'number' ? pruned : 0,
    worldVersion,
  };
  console.log(
    JSON.stringify({
      event: 'nightly_tiers',
      changed: changed.length,
      upgrades: rows.filter((r) => TIER_RANK[r.new_tier] > TIER_RANK[r.old_tier]).length,
      prunedEvidence: result.prunedEvidence,
    }),
  );
  return result;
}
