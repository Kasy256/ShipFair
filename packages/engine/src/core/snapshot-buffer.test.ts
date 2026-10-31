import { EXTRAP_MAX_MS, NET_ANIM } from '@shipfair/shared';
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_BUFFER_SIZE } from '../config.ts';
import {
  createSample,
  lerpYaw,
  type RemoteSample,
  SnapshotBuffer,
  shortestArc,
} from './snapshot-buffer.ts';

const { walk, idle } = NET_ANIM;
const sample = createSample();

/** A buffer of snaps every 100 ms along +x at 3 m/s, starting at t = 1000. */
function walking(count: number): SnapshotBuffer {
  const buffer = new SnapshotBuffer();
  for (let i = 0; i < count; i++) buffer.push(1000 + i * 100, i * 0.3, 0, 0, 0, walk);
  return buffer;
}

const at = (buffer: SnapshotBuffer, t: number): RemoteSample => {
  buffer.sample(t, sample);
  return sample;
};

describe('shortest-arc yaw', () => {
  it('takes the short way across 0 / 2π', () => {
    expect(shortestArc(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2, 10);
    expect(shortestArc(2 * Math.PI - 0.1, 0.1)).toBeCloseTo(0.2, 10);
    expect(shortestArc(1, 1)).toBe(0);
  });

  it('never turns more than half a turn, from any start', () => {
    for (let a = -10; a <= 10; a += 0.37) {
      for (let b = -10; b <= 10; b += 0.53) {
        const d = shortestArc(a, b);
        expect(Math.abs(d)).toBeLessThanOrEqual(Math.PI + 1e-9);
        // a + d points the same way as b
        expect(Math.cos(a + d)).toBeCloseTo(Math.cos(b), 9);
        expect(Math.sin(a + d)).toBeCloseTo(Math.sin(b), 9);
      }
    }
  });

  it('interpolates through the short side', () => {
    expect(lerpYaw(0.2, 2 * Math.PI - 0.2, 0.5)).toBeCloseTo(0, 10);
    expect(lerpYaw(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI, 10);
  });
});

describe('SnapshotBuffer', () => {
  it('interpolates between snapshots received in order', () => {
    const buffer = walking(4);
    expect(at(buffer, 1150).x).toBeCloseTo(0.45, 6);
    expect(sample.speed).toBeCloseTo(3, 4);
    expect(sample.anim).toBe(walk);
    expect(sample.isExtrapolating).toBe(false);
  });

  it('sorts snapshots that arrive out of order and ignores duplicates', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1200, 0.6, 0, 0, 0, walk);
    buffer.push(1000, 0, 0, 0, 0, walk);
    buffer.push(1100, 0.3, 0, 0, 0, walk);
    buffer.push(1100, 99, 0, 0, 0, walk); // a duplicate tick
    expect(buffer.count).toBe(3);
    expect(at(buffer, 1050).x).toBeCloseTo(0.15, 6);
    expect(at(buffer, 1150).x).toBeCloseTo(0.45, 6);
  });

  it(`keeps only the newest ${SNAPSHOT_BUFFER_SIZE} and drops one older than all of them`, () => {
    const buffer = walking(20);
    expect(buffer.count).toBe(SNAPSHOT_BUFFER_SIZE);
    expect(buffer.oldest).toBe(1000 + (20 - SNAPSHOT_BUFFER_SIZE) * 100);
    buffer.push(500, -5, 0, 0, 0, walk);
    expect(buffer.count).toBe(SNAPSHOT_BUFFER_SIZE);
    expect(buffer.oldest).toBe(1000 + (20 - SNAPSHOT_BUFFER_SIZE) * 100);
  });

  it('holds the first snapshot before the buffer starts', () => {
    const buffer = walking(3);
    expect(at(buffer, 0).x).toBe(0);
    expect(sample.speed).toBe(0);
  });

  it('interpolates across a gap (a lost snapshot) at the true speed', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, 0, 0, 0, 0, walk);
    buffer.push(1300, 0.9, 0, 0, 0, walk); // 1100 and 1200 never arrived
    expect(at(buffer, 1200).x).toBeCloseTo(0.6, 6);
    expect(sample.speed).toBeCloseTo(3, 4);
  });

  it(`extrapolates at most ${EXTRAP_MAX_MS} ms past the last snapshot, then holds`, () => {
    const buffer = walking(3); // last at t = 1200, x = 0.6
    expect(at(buffer, 1300).x).toBeCloseTo(0.9, 6);
    expect(sample.isExtrapolating).toBe(true);
    const capped = 0.6 + 3 * (EXTRAP_MAX_MS / 1000);
    expect(at(buffer, 1200 + EXTRAP_MAX_MS).x).toBeCloseTo(capped, 6);
    expect(at(buffer, 5000).x).toBeCloseTo(capped, 6);
    expect(sample.speed).toBe(0); // held: no walking on the spot
  });

  it('never extrapolates a player whose last snapshot is idle', () => {
    const buffer = walking(3);
    buffer.push(1300, 0.9, 0, 0, 0, idle);
    expect(at(buffer, 1450).x).toBeCloseTo(0.9, 6);
    expect(sample.isExtrapolating).toBe(false);
  });

  it('holds instead of extrapolating from snapshots far apart (stale velocity)', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, 0, 0, 0, 0, walk);
    buffer.push(3000, 1, 0, 0, 0, walk);
    expect(at(buffer, 3100).x).toBe(1);
  });

  it('interpolates yaw along the short arc', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1000, 0, 0, 0, 2 * Math.PI - 0.2, walk);
    buffer.push(1100, 0, 0, 0, 0.2, walk);
    const yaw = at(buffer, 1050).yaw;
    expect(Math.cos(yaw)).toBeCloseTo(1, 9);
    expect(Math.sin(yaw)).toBeCloseTo(0, 9);
  });

  it('clears', () => {
    const buffer = walking(3);
    buffer.clear();
    expect(buffer.count).toBe(0);
    expect(buffer.sample(1000, sample)).toBe(false);
  });
});
