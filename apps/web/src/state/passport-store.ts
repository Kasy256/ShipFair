import { type PassportAnswer, type Stamp, StampKey } from '@shipfair/shared';
import * as z from 'zod';
import { create } from 'zustand';

// The visitor's passport (prompt 13). Guests keep stamps in localStorage and offer them for merge
// on sign-in; signed-in users hold what the server awarded, plus claims it hasn't backed yet
// (`isPending`: a shard reports once a minute). The browser never decides what counts: it only
// shows stamps sooner (ARCHITECTURE.md §7 "Passport trust model").

const GUEST_KEY = 'shipfair:passport';
const OPENED_KEY = 'shipfair:passport:opened';
/** Booth ids remembered for the milestones (the top one is 100). */
const OPENED_MAX = 200;

export interface HeldStamp {
  readonly at: number;
  readonly isPending: boolean;
}

const GuestPassport = z.object({
  stamps: z.array(z.object({ stamp: StampKey, at: z.number() })).max(64),
});
const OpenedBooths = z.array(z.string().max(64)).max(OPENED_MAX);

function read<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    return parsed.success ? parsed.data : fallback;
  } catch {
    // No storage (private mode, Node tests) or bad JSON.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Could not save the passport', error);
  }
}

function guestStamps(): Map<StampKey, HeldStamp> {
  const saved = read(GUEST_KEY, GuestPassport, { stamps: [] });
  return new Map(saved.stamps.map((s) => [s.stamp, { at: s.at, isPending: false }]));
}

function saveGuest(stamps: ReadonlyMap<StampKey, HeldStamp>): void {
  write(GUEST_KEY, { stamps: [...stamps].map(([stamp, { at }]) => ({ stamp, at })) });
}

interface PassportState {
  /** The signed-in user these stamps belong to, or null for the guest. */
  owner: string | null;
  stamps: ReadonlyMap<StampKey, HeldStamp>;
  /** Booths opened on this device (milestones count them). */
  opened: readonly string[];
  /** Earned since the book was last opened: they stamp in with an animation. */
  fresh: readonly StampKey[];
  /** Claims a signed-in user still has to send. */
  queue: readonly StampKey[];
  /** Adds a stamp the visitor just earned here. False if they already had it. */
  earn(stamp: StampKey, nowMs?: number): boolean;
  /** Remembers an opened booth; returns how many distinct booths were opened. */
  markOpened(boothId: string): number;
  /** Switches to a user's (empty until loaded) passport, or back to the guest's. */
  switchTo(owner: string | null): void;
  /** The server's stamps for the signed-in user; pending claims stay. */
  setServerStamps(stamps: readonly Stamp[]): void;
  /** A claim or merge answer: awarded become real, pending wait, the rest are dropped. */
  applyAnswer(claimed: readonly StampKey[], answer: PassportAnswer): void;
  takeQueue(): StampKey[];
  /** The guest's stamps, for merging after sign-in. */
  guestClaims(): StampKey[];
  clearGuest(): void;
  markSeen(): void;
}

export const usePassportStore = create<PassportState>()((set, get) => ({
  owner: null,
  stamps: guestStamps(),
  opened: read(OPENED_KEY, OpenedBooths, []),
  fresh: [],
  queue: [],
  earn(stamp, nowMs = Date.now()) {
    const s = get();
    if (s.stamps.has(stamp)) return false;
    const stamps = new Map(s.stamps);
    stamps.set(stamp, { at: nowMs, isPending: s.owner !== null });
    set({
      stamps,
      fresh: [...s.fresh, stamp],
      queue: s.owner !== null ? [...s.queue, stamp] : s.queue,
    });
    if (s.owner === null) saveGuest(stamps);
    return true;
  },
  markOpened(boothId) {
    const opened = get().opened;
    if (opened.includes(boothId)) return opened.length;
    const next = [...opened, boothId].slice(-OPENED_MAX);
    set({ opened: next });
    write(OPENED_KEY, next);
    return next.length;
  },
  switchTo(owner) {
    if (owner === get().owner) return;
    set({ owner, stamps: owner === null ? guestStamps() : new Map(), fresh: [], queue: [] });
  },
  setServerStamps(server) {
    const stamps = new Map<StampKey, HeldStamp>();
    for (const [stamp, held] of get().stamps) if (held.isPending) stamps.set(stamp, held);
    for (const s of server) stamps.set(s.stamp, { at: Date.parse(s.createdAt), isPending: false });
    set({ stamps });
  },
  applyAnswer(claimed, answer) {
    const stamps = new Map(get().stamps);
    for (const stamp of claimed) {
      const held = stamps.get(stamp);
      if (answer.awarded.includes(stamp)) {
        stamps.set(stamp, { at: held?.at ?? Date.now(), isPending: false });
      } else if (answer.pending.includes(stamp)) {
        stamps.set(stamp, { at: held?.at ?? Date.now(), isPending: true });
      } else {
        stamps.delete(stamp);
      }
    }
    set({ stamps, fresh: get().fresh.filter((s) => stamps.has(s)) });
  },
  takeQueue() {
    const queue = [...get().queue];
    set({ queue: [] });
    return queue;
  },
  guestClaims: () => [...guestStamps().keys()],
  clearGuest: () => write(GUEST_KEY, null),
  markSeen: () => set({ fresh: [] }),
}));

/** Stamps still waiting for a shard's report. */
export const selectPending = (s: PassportState): StampKey[] =>
  [...s.stamps].filter(([, held]) => held.isPending).map(([stamp]) => stamp);
