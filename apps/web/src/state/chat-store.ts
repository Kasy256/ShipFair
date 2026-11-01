import { CHAT_LOG_LINES, type ChatLine, REPORT_CONTEXT_LINES } from '@shipfair/shared';
import { create } from 'zustand';

// Proximity chat as the UI sees it (prompt 12): the log panel's last lines, the lines each player
// sent us (attached to a report of them), and whether we're muted. Nothing here is stored
// anywhere: chat isn't persisted except as report attachments (TRUST_AND_SAFETY.md "Privacy").

export interface LogLine {
  /** Unique within the session (React key). */
  key: number;
  /** The sender's shard-local id and profile id (null for your own lines). */
  id: number;
  userId: string | null;
  name: string;
  text: string;
  /** Server time (epoch ms). */
  ts: number;
  isYou: boolean;
}

interface ChatState {
  /** Oldest first, at most CHAT_LOG_LINES. */
  lines: readonly LogLine[];
  /** Each player's last REPORT_CONTEXT_LINES lines that reached us, oldest first. */
  byUser: ReadonlyMap<string, readonly ChatLine[]>;
  /** Epoch ms until which the shard refuses our chat (auto-mute or a new account); 0 if not. */
  mutedUntil: number;
  /** The chat input is open (engine input is off meanwhile). */
  isComposing: boolean;
  addLine(line: Omit<LogLine, 'key'>): void;
  setMutedUntil(until: number): void;
  setComposing(isComposing: boolean): void;
  /** The lines to attach when reporting `userId`. */
  contextFor(userId: string): ChatLine[];
}

let nextKey = 1;

export const useChatStore = create<ChatState>()((set, get) => ({
  lines: [],
  byUser: new Map(),
  mutedUntil: 0,
  isComposing: false,
  addLine(line) {
    const lines = [...get().lines, { ...line, key: nextKey++ }].slice(-CHAT_LOG_LINES);
    if (!line.userId) {
      set({ lines });
      return;
    }
    const byUser = new Map(get().byUser);
    const theirs = [...(byUser.get(line.userId) ?? []), { text: line.text, ts: line.ts }];
    byUser.set(line.userId, theirs.slice(-REPORT_CONTEXT_LINES));
    set({ lines, byUser });
  },
  setMutedUntil: (until) => set({ mutedUntil: until }),
  setComposing: (isComposing) => set({ isComposing }),
  contextFor: (userId) => [...(get().byUser.get(userId) ?? [])],
}));
