import { describe, expect, it } from 'vitest';
import { fuzzyScore, searchBooths } from './fuzzy.ts';

const booths = [
  { name: 'Quantum Ledger', tagline: 'Double-entry books for agents' },
  { name: 'Tiny Kite', tagline: 'Fly a quantum of joy every morning' },
  { name: 'Pixel Forge', tagline: 'Sprites from a sentence' },
  { name: 'Ledgerly', tagline: 'Invoices without the spreadsheets' },
];

describe('fuzzyScore', () => {
  it('needs every query letter in order', () => {
    expect(fuzzyScore('qled', 'Quantum Ledger')).toBeGreaterThan(0);
    expect(fuzzyScore('delq', 'Quantum Ledger')).toBe(0);
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('ranks prefix > substring > scattered letters', () => {
    const prefix = fuzzyScore('ledg', 'Ledgerly');
    const word = fuzzyScore('ledg', 'Quantum Ledger');
    const scattered = fuzzyScore('ldgr', 'Quantum Ledger');
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(scattered);
  });

  it('ignores case and surrounding spaces', () => {
    expect(fuzzyScore('  PIXEL ', 'pixel forge')).toBe(fuzzyScore('pixel', 'Pixel Forge'));
  });
});

describe('searchBooths', () => {
  it('weights names over taglines', () => {
    expect(searchBooths(booths, 'quantum', 5).map((b) => b.name)).toEqual([
      'Quantum Ledger',
      'Tiny Kite',
    ]);
  });

  it('finds by tagline and respects the limit', () => {
    expect(searchBooths(booths, 'invoices', 5).map((b) => b.name)).toEqual(['Ledgerly']);
    expect(searchBooths(booths, 'e', 2)).toHaveLength(2);
  });

  it('returns nothing for a blank query', () => {
    expect(searchBooths(booths, '   ', 5)).toEqual([]);
  });
});
