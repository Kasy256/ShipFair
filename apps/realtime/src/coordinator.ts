import { Server } from 'partyserver';
import type { Env } from './env.ts';

/** Assigns players to world shards (ARCHITECTURE.md §7). A stub until prompt 10. */
export class Coordinator extends Server<Env> {}
