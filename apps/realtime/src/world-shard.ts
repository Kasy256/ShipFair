import { Server } from 'partyserver';
import type { Env } from './env.ts';

/** One room of up to MAX_PLAYERS_PER_SHARD players (ARCHITECTURE.md §7). A stub until prompt 10. */
export class WorldShard extends Server<Env> {}
