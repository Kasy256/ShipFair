import { describe, expect, it } from 'vitest';
import { CLOCK_SNAP_MS, CLOCK_WINDOW } from '../config.ts';
import { ClockSync } from './clock-sync.ts';

/** Server clock = local clock + OFFSET; snaps every 100 ms, each delayed by `delay(i)`. */
const OFFSET = 5_000_000;

function feed(clock: ClockSync, count: number, delay: (i: number) => number, start = 0): void {
  for (let i = 0; i < count; i++) {
    const serverT = OFFSET + start + i * 100;
    clock.onServerTime(serverT, serverT - OFFSET + delay(i));
  }
}

describe('ClockSync', () => {
  it('is not ready until the first server time', () => {
    const clock = new ClockSync();
    expect(clock.isReady).toBe(false);
    clock.onServerTime(OFFSET + 1000, 1000);
    expect(clock.isReady).toBe(true);
  });

  it('measures RTT from ping/pong and smooths it', () => {
    const clock = new ClockSync();
    clock.onPong(1000, 1080);
    expect(clock.rttMs).toBe(80);
    clock.onPong(2000, 2040);
    expect(clock.rttMs).toBeGreaterThan(40);
    expect(clock.rttMs).toBeLessThan(80);
  });

  it('estimates the offset from the least-delayed snaps plus half the RTT', () => {
    const clock = new ClockSync();
    clock.onPong(0, 60); // one way ≈ 30 ms
    // 30 ms of base latency plus up to 50 ms of jitter.
    feed(clock, CLOCK_WINDOW * 2, (i) => 30 + ((i * 37) % 50));
    expect(Math.abs(clock.offsetMs - OFFSET)).toBeLessThan(5);
    expect(clock.serverNow(1000)).toBeCloseTo(OFFSET + 1000, -1);
  });

  it('eases small corrections instead of jumping', () => {
    const clock = new ClockSync();
    feed(clock, CLOCK_WINDOW, () => 20);
    const before = clock.offsetMs;
    // The network gets 60 ms faster: the estimate moves, but by less than the whole step at once.
    feed(clock, 1, () => -40, CLOCK_WINDOW * 100);
    const step = clock.offsetMs - before;
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(60);
  });

  it(`snaps to a new estimate more than ${CLOCK_SNAP_MS} ms away (server restart, tab sleep)`, () => {
    const clock = new ClockSync();
    feed(clock, CLOCK_WINDOW, () => 20);
    for (let i = 0; i < CLOCK_WINDOW; i++)
      clock.onServerTime(OFFSET + 10_000_000 + i * 100, 1e6 + i * 100);
    expect(clock.offsetMs).toBeCloseTo(OFFSET + 10_000_000 - 1e6, -1);
  });

  it('forgets samples older than the window, so a slower network is followed', () => {
    const clock = new ClockSync();
    feed(clock, CLOCK_WINDOW, () => 10);
    const fast = clock.offsetMs;
    feed(clock, CLOCK_WINDOW * 4, () => 110, CLOCK_WINDOW * 100);
    expect(fast - clock.offsetMs).toBeGreaterThan(90);
  });

  it('resets on reconnect', () => {
    const clock = new ClockSync();
    feed(clock, 4, () => 10);
    clock.reset();
    expect(clock.isReady).toBe(false);
    expect(Number.isNaN(clock.rttMs)).toBe(true);
  });
});
