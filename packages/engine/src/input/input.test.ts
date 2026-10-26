// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_DT_S, JOYSTICK_RADIUS_PX } from '../config.ts';
import { deadzone } from './gamepad.ts';
import { applyKeys, isTypingTarget } from './keyboard.ts';
import { InputManager } from './manager.ts';
import { clampMove, createInputState } from './state.ts';
import { type JoystickReading, readJoystick } from './touch.ts';

describe('applyKeys', () => {
  const read = (...codes: string[]) => {
    const state = createInputState();
    applyKeys(new Set(codes), state);
    clampMove(state);
    return state;
  };

  it('maps WASD and arrows to the move axes', () => {
    expect(read('KeyW')).toMatchObject({ moveX: 0, moveY: 1 });
    expect(read('ArrowDown')).toMatchObject({ moveX: 0, moveY: -1 });
    expect(read('KeyA')).toMatchObject({ moveX: -1, moveY: 0 });
    expect(read('ArrowRight')).toMatchObject({ moveX: 1, moveY: 0 });
  });

  it('cancels opposite keys and does not double up W + ArrowUp', () => {
    expect(read('KeyW', 'KeyS')).toMatchObject({ moveY: 0 });
    expect(read('KeyW', 'ArrowUp')).toMatchObject({ moveY: 1 });
  });

  it('normalises diagonals to the unit disc', () => {
    const s = read('KeyW', 'KeyD');
    expect(Math.hypot(s.moveX, s.moveY)).toBeCloseTo(1, 9);
  });

  it('runs with either Shift', () => {
    expect(read('ShiftLeft').run).toBe(true);
    expect(read('ShiftRight').run).toBe(true);
    expect(read('KeyW').run).toBe(false);
  });
});

describe('readJoystick', () => {
  const out = (): JoystickReading => ({ x: 0, y: 0, isRunning: false });

  it('ignores the deadzone', () => {
    expect(readJoystick(3, 2, out())).toEqual({ x: 0, y: 0, isRunning: false });
  });

  it('points forward when dragged up the screen, full at the rim', () => {
    const r = readJoystick(0, -JOYSTICK_RADIUS_PX, out());
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(1, 9);
    expect(r.isRunning).toBe(true);
  });

  it('clamps past the rim and scales partial pushes', () => {
    expect(readJoystick(JOYSTICK_RADIUS_PX * 3, 0, out()).x).toBeCloseTo(1, 9);
    const half = readJoystick(-JOYSTICK_RADIUS_PX / 2, 0, out());
    expect(half.x).toBeLessThan(-0.3);
    expect(half.x).toBeGreaterThan(-0.5);
    expect(half.isRunning).toBe(false);
  });
});

describe('gamepad deadzone', () => {
  it('zeroes small values and rescales the rest', () => {
    expect(deadzone(0.1)).toBe(0);
    expect(deadzone(1)).toBeCloseTo(1, 9);
    expect(deadzone(-1)).toBeCloseTo(-1, 9);
  });
});

describe('isTypingTarget', () => {
  it('recognises text fields', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('InputManager', () => {
  let manager: InputManager | undefined;
  afterEach(() => {
    manager?.dispose();
    manager = undefined;
  });

  const key = (type: 'keydown' | 'keyup', code: string, target: EventTarget = window) =>
    target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));

  it('turns key events into move axes and press-once actions', () => {
    manager = new InputManager(document.createElement('canvas'));
    key('keydown', 'KeyW');
    key('keydown', 'Space');
    manager.fixedUpdate(FIXED_DT_S);
    expect(manager.state.moveY).toBe(1);
    expect(manager.state.jump).toBe(true);
    key('keyup', 'KeyW');
    manager.fixedUpdate(FIXED_DT_S);
    expect(manager.state.moveY).toBe(0);
  });

  it('ignores keys typed into a text field', () => {
    manager = new InputManager(document.createElement('canvas'));
    const field = document.createElement('input');
    document.body.appendChild(field);
    key('keydown', 'KeyW', field);
    manager.fixedUpdate(FIXED_DT_S);
    expect(manager.state.moveY).toBe(0);
    field.remove();
  });

  it('setEnabled(false) zeroes the state and ignores everything until re-enabled', () => {
    manager = new InputManager(document.createElement('canvas'));
    key('keydown', 'KeyD');
    manager.state.lookYaw = 0.3;
    manager.setEnabled(false);
    expect(manager.state).toMatchObject({ moveX: 0, lookYaw: 0, jump: false });
    key('keydown', 'KeyW');
    key('keydown', 'Space');
    manager.script.isActive = true;
    manager.script.moveY = 1;
    manager.fixedUpdate(FIXED_DT_S);
    expect(manager.state).toMatchObject({ moveX: 0, moveY: 0, jump: false });
    manager.setEnabled(true);
    manager.fixedUpdate(FIXED_DT_S);
    expect(manager.state.moveY).toBe(1); // held W (re-pressed while disabled) plus the script
  });

  it('clears held keys when the window loses focus', () => {
    manager = new InputManager(document.createElement('canvas'));
    key('keydown', 'KeyW');
    window.dispatchEvent(new Event('blur'));
    manager.fixedUpdate(FIXED_DT_S);
    expect(manager.state.moveY).toBe(0);
  });
});
