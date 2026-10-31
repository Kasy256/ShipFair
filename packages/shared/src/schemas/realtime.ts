import * as z from 'zod';
import { ShardId } from '../protocol.ts';
import { Handle, Timestamp, Uuid } from './common.ts';

// Payloads of the realtime ↔ web RPC calls (ARCHITECTURE.md §6). Both sides parse them: an RPC
// argument crosses a Worker boundary, so it is external input like any other.

const DISPLAY_NAME_MAX_CHARS = 32;
const STATS_ROWS_MAX = 5000;
const STATS_COUNT_MAX = 1_000_000;

/** `WebRpc.getPlayer(userId)`: what a shard needs on `hello`. `profile` is null if there is none. */
export const PlayerRecord = z.object({
  profile: z
    .object({
      id: Uuid,
      handle: Handle,
      displayName: z.string().min(1).max(DISPLAY_NAME_MAX_CHARS),
      /** Stored jsonb, any version; the shard decides what it can send. */
      avatarStyle: z.unknown(),
      createdAt: Timestamp,
    })
    .nullable(),
  /** Read on every call from `bans` and `banned_identities`, never cached. */
  banned: z.boolean(),
});
export type PlayerRecord = z.infer<typeof PlayerRecord>;

const Count = z.int().min(0).max(STATS_COUNT_MAX);

/** One booth-day of counts from one shard; the web Worker adds them to `booth_stats_daily`. */
export const BoothStatsRow = z.object({
  boothId: Uuid,
  day: z.iso.date(),
  visits: Count,
  uniqueVisitors: Count,
});
export type BoothStatsRow = z.infer<typeof BoothStatsRow>;

/** `WebRpc.ingestStats(batch)`: a shard's visit counts since its last report (every 60 s). */
export const StatsBatch = z.object({
  shard: ShardId,
  /** `STATS_INGEST_SECRET`, a second layer on top of the service binding. */
  secret: z.string().min(1).max(256),
  rows: z.array(BoothStatsRow).max(STATS_ROWS_MAX),
});
export type StatsBatch = z.infer<typeof StatsBatch>;
