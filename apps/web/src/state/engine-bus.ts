import { createBus, type EngineEvents, type EventBus } from '@shipfair/shared';

/** The one engine ↔ UI event bus (ARCHITECTURE.md §3). */
export const engineBus: EventBus = createBus<EngineEvents>();
