import { readFileSync } from 'node:fs';

export type Tier = 'high' | 'low';

export interface TierBudget {
  drawCalls: number;
  triangles: number;
  textureMb: number;
}

export interface PerfBudgets {
  scenario: { booths: number; remotes: number; viewport: { width: number; height: number } };
  tiers: Record<Tier, TierBudget>;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Reads `e2e/perf-budgets.json` (the one place the numbers live) and checks its shape. */
export function loadBudgets(): PerfBudgets {
  const url = new URL('../../perf-budgets.json', import.meta.url);
  const json = JSON.parse(readFileSync(url, 'utf8')) as PerfBudgets;
  const { scenario, tiers } = json;
  const numbers = [
    scenario?.booths,
    scenario?.remotes,
    scenario?.viewport?.width,
    scenario?.viewport?.height,
    ...(['high', 'low'] as const).flatMap((t) => [
      tiers?.[t]?.drawCalls,
      tiers?.[t]?.triangles,
      tiers?.[t]?.textureMb,
    ]),
  ];
  if (!numbers.every(isCount)) throw new Error('e2e/perf-budgets.json: missing or invalid number');
  return json;
}
