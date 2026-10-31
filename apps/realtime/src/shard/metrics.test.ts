import { describe, expect, it } from 'vitest';
import { ShardMetrics } from './metrics.ts';

describe('ShardMetrics', () => {
  it('reports p50/p95 tick times and per-player snap bytes, then resets', () => {
    const metrics = new ShardMetrics(0);
    for (let i = 1; i <= 100; i++) metrics.recordTick(i / 10); // 0.1 … 10 ms
    metrics.recordSnap(10, 140);
    metrics.recordSnap(30, 380);
    metrics.recordSend(140);
    metrics.msgsIn = 7;
    metrics.clamped = 2;
    const report = metrics.take('w-1', 12, 60_000);
    expect(report).toMatchObject({
      shard: 'w-1',
      players: 12,
      msgsIn: 7,
      msgsOut: 1,
      bytesOut: 140,
      snaps: 2,
      snapEntriesAvg: 20,
      snapBytesPerPlayer: 13,
      ticks: 100,
      tickP50Ms: 5,
      tickP95Ms: 9.5,
      tickMaxMs: 10,
      clamped: 2,
      periodS: 60,
    });
    expect(metrics.take('w-1', 12, 120_000)).toMatchObject({
      msgsIn: 0,
      ticks: 0,
      tickP95Ms: 0,
      periodS: 60,
    });
  });
});
