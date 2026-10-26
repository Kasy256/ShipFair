import { describe, expect, it } from 'vitest';
import { FIXED_DT_S, MAX_SUBSTEPS } from '../config.ts';
import { Loop, planSteps, type StepPlan, type System } from './loop.ts';

const plan = (): StepPlan => ({ steps: 0, accumulator: 0, alpha: 0 });

describe('planSteps', () => {
  it('runs exactly one step for exactly one fixed dt', () => {
    const out = planSteps(0, FIXED_DT_S, plan());
    expect(out.steps).toBe(1);
    expect(out.accumulator).toBeCloseTo(0, 12);
    expect(out.alpha).toBeCloseTo(0, 9);
  });

  it('accumulates short frames and reports alpha', () => {
    const out = plan();
    planSteps(0, FIXED_DT_S / 2, out);
    expect(out.steps).toBe(0);
    expect(out.alpha).toBeCloseTo(0.5, 9);
    planSteps(out.accumulator, FIXED_DT_S * 0.75, out);
    expect(out.steps).toBe(1);
    expect(out.alpha).toBeCloseTo(0.25, 9);
  });

  it('runs several steps for a long frame', () => {
    const out = planSteps(0, FIXED_DT_S * 3.5, plan());
    expect(out.steps).toBe(3);
    expect(out.alpha).toBeCloseTo(0.5, 9);
  });

  it(`caps at ${MAX_SUBSTEPS} substeps and drops the backlog`, () => {
    const out = planSteps(0, 0.2, plan()); // 12 steps due
    expect(out.steps).toBe(MAX_SUBSTEPS);
    expect(out.accumulator).toBeLessThan(FIXED_DT_S);
    expect(out.alpha).toBeGreaterThanOrEqual(0);
    expect(out.alpha).toBeLessThan(1);
  });

  it('clamps huge, negative and non-finite frames', () => {
    expect(planSteps(0, 10, plan()).steps).toBe(MAX_SUBSTEPS);
    expect(planSteps(0, -1, plan()).steps).toBe(0);
    expect(planSteps(0, Number.NaN, plan()).steps).toBe(0);
  });

  it('keeps 60 Hz exact over many 1/60 s frames (no drift)', () => {
    const out = plan();
    let steps = 0;
    for (let i = 0; i < 6000; i++) steps += planSteps(out.accumulator, FIXED_DT_S, out).steps;
    expect(steps).toBe(6000);
  });

  it('runs 60 steps per second at 144 Hz rendering', () => {
    const out = plan();
    let steps = 0;
    for (let i = 0; i < 144; i++) steps += planSteps(out.accumulator, 1 / 144, out).steps;
    expect(steps).toBe(60);
  });
});

function recorder(name: string, log: string[]): System & { alphas: number[] } {
  const alphas: number[] = [];
  return {
    alphas,
    fixedUpdate: (dt) => log.push(`${name}.fixed(${dt.toFixed(4)})`),
    update: (_dt, alpha) => {
      alphas.push(alpha);
      log.push(`${name}.update`);
    },
    dispose: () => log.push(`${name}.dispose`),
  };
}

describe('Loop', () => {
  it('runs fixed updates, then updates, in registration order', () => {
    const log: string[] = [];
    const loop = new Loop({ requestFrame: () => 0, cancelFrame: () => {} });
    loop.add(recorder('a', log));
    loop.add(recorder('b', log));
    loop.advance(FIXED_DT_S);
    expect(log).toEqual(['a.fixed(0.0167)', 'b.fixed(0.0167)', 'a.update', 'b.update']);
  });

  it('step(dt, n) advances deterministically without rAF', () => {
    let requested = 0;
    const loop = new Loop({ requestFrame: () => ++requested, cancelFrame: () => {} });
    loop.step(FIXED_DT_S, 120);
    expect(loop.fixedSteps).toBe(120);
    expect(loop.frames).toBe(120);
    expect(loop.time).toBeCloseTo(2, 9);
    expect(requested).toBe(0);
  });

  it('passes alpha between fixed steps to update', () => {
    const loop = new Loop({ requestFrame: () => 0, cancelFrame: () => {} });
    const sys = loop.add(recorder('a', []));
    loop.advance(FIXED_DT_S * 0.25);
    loop.advance(FIXED_DT_S * 0.5);
    expect(sys.alphas[0]).toBeCloseTo(0.25, 9);
    expect(sys.alphas[1]).toBeCloseTo(0.75, 9);
  });

  it('drives itself from requestAnimationFrame timestamps', () => {
    const callbacks: ((t: number) => void)[] = [];
    const loop = new Loop({
      requestFrame: (cb) => callbacks.push(cb),
      cancelFrame: () => {},
    });
    loop.start();
    let t = 1000;
    for (let i = 0; i < 61; i++) {
      callbacks.shift()?.(t);
      t += 1000 / 60;
    }
    expect(loop.fixedSteps).toBe(60); // the first frame only sets the clock
    expect(loop.frameMs).toBeCloseTo(1000 / 60, 6);
    loop.stop();
    expect(loop.isRunning).toBe(false);
  });

  it('disposes systems in reverse order and keeps going after a failure', () => {
    const log: string[] = [];
    const loop = new Loop({ requestFrame: () => 0, cancelFrame: () => {} });
    loop.add(recorder('a', log));
    loop.add({
      dispose: () => {
        log.push('bad.dispose');
        throw new Error('boom');
      },
    });
    loop.add(recorder('c', log));
    expect(() => loop.dispose()).toThrow('boom');
    expect(log).toEqual(['c.dispose', 'bad.dispose', 'a.dispose']);
  });
});
