import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_TICK_S } from '../config.ts';
import { BackgroundPause } from './background.ts';
import { Loop } from './loop.ts';

describe('BackgroundPause', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    let frames = 0;
    const loop = new Loop({ requestFrame: () => ++frames, cancelFrame: () => undefined });
    const ticks: number[] = [];
    const pause = new BackgroundPause(loop, (dt) => ticks.push(dt));
    return { loop, ticks, pause };
  };

  it('stops the loop and ticks once a BACKGROUND_TICK_S while hidden', () => {
    const { loop, ticks, pause } = setup();
    loop.start();
    pause.pause();
    expect(loop.isRunning).toBe(false);
    expect(pause.isPaused).toBe(true);
    vi.advanceTimersByTime(BACKGROUND_TICK_S * 1000 * 3 + 10);
    expect(ticks).toEqual([BACKGROUND_TICK_S, BACKGROUND_TICK_S, BACKGROUND_TICK_S]);
  });

  it('restarts the loop and stops ticking when shown; pause and resume are idempotent', () => {
    const { loop, ticks, pause } = setup();
    loop.start();
    pause.pause();
    pause.pause();
    pause.resume();
    pause.resume();
    expect(loop.isRunning).toBe(true);
    vi.advanceTimersByTime(BACKGROUND_TICK_S * 5000);
    expect(ticks).toEqual([]);
  });

  it('dispose clears the timer without restarting the loop', () => {
    const { loop, ticks, pause } = setup();
    loop.start();
    pause.pause();
    pause.dispose();
    vi.advanceTimersByTime(BACKGROUND_TICK_S * 5000);
    expect(ticks).toEqual([]);
    expect(loop.isRunning).toBe(false);
  });
});
