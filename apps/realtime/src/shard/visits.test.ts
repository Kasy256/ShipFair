import { describe, expect, it } from 'vitest';
import { utcDay, type VisitSink, VisitTracker } from './visits.ts';

const DAY = '2026-10-31';

function recorder(): VisitSink & { visits: string[] } {
  const visits: string[] = [];
  return { visits, record: (day, player, booth) => visits.push(`${day}:${player}:${booth}`) };
}

describe('VisitTracker', () => {
  it('records one visit once a player has stayed 5 s by the same booth', () => {
    const sink = recorder();
    const tracker = new VisitTracker();
    tracker.update(1, 'ada', 'b1', 0.1, DAY, sink); // arrives
    for (let i = 0; i < 49; i++) tracker.update(1, 'ada', 'b1', 0.1, DAY, sink);
    expect(sink.visits).toEqual([]);
    tracker.update(1, 'ada', 'b1', 0.1, DAY, sink); // 5.0 s
    for (let i = 0; i < 50; i++) tracker.update(1, 'ada', 'b1', 0.1, DAY, sink);
    expect(sink.visits).toEqual([`${DAY}:ada:b1`]);
  });

  it('restarts the timer when the player moves to another booth or away', () => {
    const sink = recorder();
    const tracker = new VisitTracker();
    for (let i = 0; i < 4; i++) tracker.update(1, 'ada', 'b1', 1, DAY, sink);
    tracker.update(1, 'ada', null, 1, DAY, sink);
    for (let i = 0; i < 4; i++) tracker.update(1, 'ada', 'b2', 1, DAY, sink);
    expect(sink.visits).toEqual([]);
    for (let i = 0; i < 3; i++) tracker.update(1, 'ada', 'b2', 1, DAY, sink);
    expect(sink.visits).toEqual([`${DAY}:ada:b2`]);
  });

  it('forgets a player who left', () => {
    const sink = recorder();
    const tracker = new VisitTracker();
    for (let i = 0; i < 4; i++) tracker.update(1, 'ada', 'b1', 1, DAY, sink);
    tracker.forget(1);
    for (let i = 0; i < 4; i++) tracker.update(1, 'bob', 'b1', 1, DAY, sink);
    expect(sink.visits).toEqual([]);
  });
});

describe('utcDay', () => {
  it('uses the UTC calendar day', () => {
    expect(utcDay(Date.UTC(2026, 9, 31, 23, 59))).toBe('2026-10-31');
    expect(utcDay(Date.UTC(2026, 10, 1, 0, 0))).toBe('2026-11-01');
  });
});
