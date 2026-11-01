import { CHAT_LOG_LINES, REPORT_CONTEXT_LINES } from '@shipfair/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { countdownText } from '../ui/errors.ts';
import { useChatStore } from './chat-store.ts';
import { useSessionStore } from './session-store.ts';
import { useUiStore } from './ui-store.ts';
import { useWorldStore } from './world-store.ts';

const ADA = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000a2';
const BOOTH = '00000000-0000-4000-8000-0000000000f1';

const line = (i: number, userId: string | null = ADA) => ({
  id: 2,
  userId,
  name: 'Ada',
  text: `line ${i}`,
  ts: 1_000 + i,
  isYou: userId === null,
});

describe('chat store', () => {
  beforeEach(() => useChatStore.setState({ lines: [], byUser: new Map(), mutedUntil: 0 }));

  it(`keeps the last ${CHAT_LOG_LINES} log lines`, () => {
    for (let i = 1; i <= 40; i++) useChatStore.getState().addLine(line(i));
    const { lines } = useChatStore.getState();
    expect(lines).toHaveLength(CHAT_LOG_LINES);
    expect(lines[0]?.text).toBe('line 11');
    expect(new Set(lines.map((l) => l.key)).size).toBe(CHAT_LOG_LINES);
  });

  it(`keeps each player's last ${REPORT_CONTEXT_LINES} lines for reports, oldest first`, () => {
    for (let i = 1; i <= 25; i++) useChatStore.getState().addLine(line(i));
    useChatStore.getState().addLine(line(99, BOB));
    useChatStore.getState().addLine(line(100, null)); // your own lines are never attached
    const context = useChatStore.getState().contextFor(ADA);
    expect(context).toHaveLength(REPORT_CONTEXT_LINES);
    expect(context[0]).toEqual({ text: 'line 6', ts: 1_006 });
    expect(context.at(-1)).toEqual({ text: 'line 25', ts: 1_025 });
    expect(useChatStore.getState().contextFor(BOB)).toEqual([{ text: 'line 99', ts: 1_099 }]);
  });
});

describe('mutes, makers and the player card', () => {
  it('mutes and unmutes a player once each', () => {
    const { setMuted } = useSessionStore.getState();
    setMuted(ADA, true);
    setMuted(ADA, true);
    setMuted(BOB, true);
    expect(useSessionStore.getState().mutedUserIds).toEqual([ADA, BOB]);
    setMuted(ADA, false);
    expect(useSessionStore.getState().mutedUserIds).toEqual([BOB]);
  });

  it('maps every booth of a maker present to their net id', () => {
    useWorldStore.getState().setMakersHere([{ id: 7, boothIds: [BOOTH] }]);
    expect(useWorldStore.getState().makersHere.get(BOOTH)).toBe(7);
    useWorldStore.getState().setMakersHere([]);
    expect(useWorldStore.getState().makersHere.size).toBe(0);
  });

  it('opening a player card closes the booth panel, and the other way round', () => {
    const ui = useUiStore.getState();
    ui.openBooth(BOOTH);
    ui.selectPlayer({ id: 3, userId: ADA, name: 'Ada', isGuest: false });
    expect(useUiStore.getState().openBoothId).toBeNull();
    useUiStore.getState().openBooth(BOOTH);
    expect(useUiStore.getState().selectedPlayer).toBeNull();
  });

  it('formats the mute countdown as m:ss', () => {
    expect(countdownText(10_000 + 245_000, 10_000)).toBe('4:05');
    expect(countdownText(0, 10_000)).toBe('0:00');
  });
});
