import { describe, expect, it } from 'vitest';
import { isInBounds, isReachable, maxStepM } from './movement.ts';

const origin = { x: 0, y: 0, z: 0 };
const bounds = { minX: -30, minZ: -30, maxX: 30, maxZ: 30 };

describe('isReachable', () => {
  it('allows MAX_SPEED_MPS × elapsed × 1.25 + 0.5 m', () => {
    expect(maxStepM(1)).toBe(10.5);
    expect(maxStepM(0)).toBe(0.5);
    expect(isReachable(origin, { x: 10.5, y: 0, z: 0 }, 1)).toBe(true);
    expect(isReachable(origin, { x: 10.6, y: 0, z: 0 }, 1)).toBe(false);
    expect(isReachable(origin, { x: 0.4, y: 0, z: 0.2 }, 0)).toBe(true);
  });

  it('counts height, so a flying hack is caught', () => {
    expect(isReachable(origin, { x: 0, y: 3, z: 0 }, 0.1)).toBe(false);
  });

  it('treats a clock that went backwards as no time at all', () => {
    expect(maxStepM(-5)).toBe(0.5);
  });
});

describe('isInBounds', () => {
  it('allows a 5 m margin past the city edge and a sane height band', () => {
    expect(isInBounds(bounds, { x: 34.9, y: 0, z: -34.9 })).toBe(true);
    expect(isInBounds(bounds, { x: 35.1, y: 0, z: 0 })).toBe(false);
    expect(isInBounds(bounds, { x: 0, y: -6, z: 0 })).toBe(false);
    expect(isInBounds(bounds, { x: 0, y: 51, z: 0 })).toBe(false);
  });
});
