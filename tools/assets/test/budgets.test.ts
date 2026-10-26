import { describe, expect, it } from 'vitest';
import { checkBudget, countTriangles, largestAlternative } from '../lib/stats.ts';
import { worstOutfit } from '../lib/wardrobe.ts';
import { character, contract } from './fixtures.ts';

describe('triangle counting', () => {
  it('counts only the largest of mutually exclusive hairs', () => {
    // body: 2 boxes × 12 triangles; hairs: 12 triangles each
    const doc = character(['SKIN', 'TOP'], { extraNodes: ['hair_01', 'hair_02'] });
    expect(countTriangles(doc)).toBe(48);
    expect(countTriangles(doc, ['hair_01', 'hair_02'])).toBe(36);
    expect(largestAlternative(doc, ['hair_01', 'hair_02'])).toBe(12);
  });

  it('sums the largest item per slot for the worst-case outfit', () => {
    const items = [
      { kind: 'top' as const, triangles: 2000 },
      { kind: 'top' as const, triangles: 2400 },
      { kind: 'hair' as const, triangles: 3000 },
      { kind: 'shoes' as const, triangles: 300 },
    ];
    expect(worstOutfit(items)).toBe(5700);
  });
});

describe('budget checker', () => {
  const base = { triangles: 1000, materials: 1, bytes: 10 * 1024, bones: 0 };

  it('passes inside every limit', () => {
    const stats = checkBudget('bench.glb', base, contract.budgets.prop);
    expect(stats).toMatchObject({ isOverBudget: false, problems: [] });
  });

  it('reports each limit that is exceeded, with units', () => {
    const stats = checkBudget(
      'body.glb',
      { triangles: 15001, materials: 8, bytes: 601 * 1024, bones: 71 },
      contract.budgets.characterLod0,
    );
    expect(stats.isOverBudget).toBe(true);
    expect(stats.problems).toEqual([
      'body.glb: triangles 15001 is over the budget of 15000',
      'body.glb: materials 8 is over the budget of 7',
      'body.glb: file size 601 KB is over the budget of 600 KB',
      'body.glb: deform bones 71 is over the budget of 70',
    ]);
  });

  it('reads the deform-bone limit from art/contract.json', () => {
    expect(contract.budgets.characterLod0.deformBones).toBe(70);
  });
});
