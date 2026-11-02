import { BACKGROUND_TICK_S } from '../config.ts';
import type { Loop } from './loop.ts';

/**
 * A hidden tab renders nothing: the loop stops (rather than relying on the browser to throttle
 * rAF), and only `tick` runs, every BACKGROUND_TICK_S on a timer, so the realtime client keeps
 * sending idle heartbeats and pings and the shard keeps the player. Showing the tab again
 * restarts the loop; its first frame has dt 0, so nothing jumps.
 */
export class BackgroundPause {
  readonly #loop: Loop;
  readonly #tick: (dt: number) => void;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(loop: Loop, tick: (dt: number) => void) {
    this.#loop = loop;
    this.#tick = tick;
  }

  get isPaused(): boolean {
    return this.#timer !== undefined;
  }

  pause(): void {
    if (this.#timer !== undefined) return;
    this.#loop.stop();
    this.#timer = setInterval(() => this.#tick(BACKGROUND_TICK_S), BACKGROUND_TICK_S * 1000);
  }

  resume(): void {
    if (this.#timer === undefined) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#loop.start();
  }

  dispose(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
