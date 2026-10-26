import { FIXED_DT_S, MAX_FRAME_S, MAX_SUBSTEPS } from '../config.ts';

/**
 * Something the loop drives. `fixedUpdate` runs at exactly FIXED_HZ (physics, movement);
 * `update` runs once per rendered frame with `alpha` ∈ [0, 1), how far the clock is between the
 * last two fixed steps, so visuals can interpolate. Every system cleans up in `dispose`.
 */
export interface System {
  fixedUpdate?(dt: number): void;
  update?(dt: number, alpha: number): void;
  dispose(): void;
}

/** Output of `planSteps`, reused by the caller so planning a frame allocates nothing. */
export interface StepPlan {
  steps: number;
  accumulator: number;
  alpha: number;
}

// Float slack so that adding exactly 1/60 to an empty accumulator always yields one step.
const EPSILON_S = 1e-9;

/**
 * Pure accumulator math. Adds a frame's (clamped) time and decides how many fixed steps to run.
 * When more than `maxSubsteps` are due, the backlog is dropped instead of spiralling: the game
 * slows down rather than freezing.
 */
export function planSteps(
  accumulator: number,
  frameDt: number,
  out: StepPlan,
  fixedDt = FIXED_DT_S,
  maxSubsteps = MAX_SUBSTEPS,
): StepPlan {
  const dt = Number.isFinite(frameDt) ? Math.min(Math.max(frameDt, 0), MAX_FRAME_S) : 0;
  let acc = accumulator + dt;
  let steps = Math.floor((acc + EPSILON_S) / fixedDt);
  acc = Math.max(0, acc - steps * fixedDt);
  if (steps > maxSubsteps) {
    steps = maxSubsteps;
    acc %= fixedDt;
  }
  out.steps = steps;
  out.accumulator = acc;
  out.alpha = Math.min(acc / fixedDt, 1 - EPSILON_S);
  return out;
}

export interface LoopOptions {
  /** Injectable for tests; default `requestAnimationFrame`. */
  requestFrame?: (callback: (timeMs: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

/** The engine's one game loop. Nothing else calls `requestAnimationFrame`. */
export class Loop {
  readonly #systems: System[] = [];
  readonly #plan: StepPlan = { steps: 0, accumulator: 0, alpha: 0 };
  readonly #requestFrame: (callback: (timeMs: number) => void) => number;
  readonly #cancelFrame: (handle: number) => void;
  #accumulator = 0;
  #handle = 0;
  #lastMs = -1;
  #isRunning = false;
  /** Simulated seconds (sum of fixed steps). Deterministic, unlike wall time. */
  time = 0;
  fixedSteps = 0;
  frames = 0;
  /** Wall-clock length of the last rAF frame, for the perf overlay. */
  frameMs = 0;

  constructor(options: LoopOptions = {}) {
    this.#requestFrame = options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.#cancelFrame = options.cancelFrame ?? ((h) => cancelAnimationFrame(h));
  }

  get isRunning(): boolean {
    return this.#isRunning;
  }

  /** Systems run in the order they were added (render last). */
  add<T extends System>(system: T): T {
    this.#systems.push(system);
    return system;
  }

  remove(system: System): void {
    const i = this.#systems.indexOf(system);
    if (i >= 0) this.#systems.splice(i, 1);
  }

  /** Advances by one frame of `frameDt` seconds. Returns how many fixed steps ran. */
  advance(frameDt: number): number {
    const plan = planSteps(this.#accumulator, frameDt, this.#plan);
    this.#accumulator = plan.accumulator;
    const systems = this.#systems;
    for (let s = 0; s < plan.steps; s++) {
      for (let i = 0; i < systems.length; i++) systems[i]?.fixedUpdate?.(FIXED_DT_S);
      this.time += FIXED_DT_S;
      this.fixedSteps++;
    }
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_S);
    for (let i = 0; i < systems.length; i++) systems[i]?.update?.(dt, plan.alpha);
    this.frames++;
    return plan.steps;
  }

  /** Test mode: `n` frames of `dt` seconds, with no rAF and no wall clock. */
  step(dt: number, n = 1): void {
    for (let i = 0; i < n; i++) this.advance(dt);
  }

  start(): void {
    if (this.#isRunning) return;
    this.#isRunning = true;
    this.#lastMs = -1;
    this.#handle = this.#requestFrame(this.#tick);
  }

  stop(): void {
    if (!this.#isRunning) return;
    this.#isRunning = false;
    this.#cancelFrame(this.#handle);
  }

  /** Stops the loop and disposes every system, last added first. */
  dispose(): void {
    this.stop();
    let failure: unknown;
    for (let i = this.#systems.length - 1; i >= 0; i--) {
      try {
        this.#systems[i]?.dispose();
      } catch (error) {
        failure ??= error;
      }
    }
    this.#systems.length = 0;
    if (failure !== undefined) throw failure;
  }

  // Bound once, so scheduling the next frame allocates nothing.
  readonly #tick = (timeMs: number): void => {
    if (!this.#isRunning) return;
    const dt = this.#lastMs < 0 ? 0 : (timeMs - this.#lastMs) / 1000;
    this.frameMs = this.#lastMs < 0 ? 0 : timeMs - this.#lastMs;
    this.#lastMs = timeMs;
    this.#handle = this.#requestFrame(this.#tick);
    this.advance(dt);
  };
}
