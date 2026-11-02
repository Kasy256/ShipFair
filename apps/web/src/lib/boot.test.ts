import { describe, expect, it } from 'vitest';
import { isWorldPath } from './boot.ts';

describe('isWorldPath', () => {
  it('is true for the three routes that show the city', () => {
    for (const path of ['/', '/b/my-booth', '/b/my-booth/', '/d/dev-tools']) {
      expect(isWorldPath(path), path).toBe(true);
    }
  });

  it('is false for every other page', () => {
    for (const path of ['/submit', '/me', '/u/someone', '/admin', '/rules', '/b/', '/b/a/b']) {
      expect(isWorldPath(path), path).toBe(false);
    }
  });
});
