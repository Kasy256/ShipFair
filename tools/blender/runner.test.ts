import { describe, expect, it } from 'vitest';
import {
  artPaths,
  blenderArgs,
  findBlender,
  isSupportedVersion,
  parseBlenderVersion,
  stepResultSchema,
} from './runner.ts';

describe('parseBlenderVersion', () => {
  it('reads major and minor from --version output', () => {
    expect(parseBlenderVersion('Blender 3.6.23 (hash e467db79ca8c built 2025-06-17)')).toEqual({
      major: 3,
      minor: 6,
    });
    expect(parseBlenderVersion('no version here')).toBeNull();
  });

  it('accepts 3.6 and newer only', () => {
    expect(isSupportedVersion({ major: 3, minor: 6 })).toBe(true);
    expect(isSupportedVersion({ major: 4, minor: 0 })).toBe(true);
    expect(isSupportedVersion({ major: 3, minor: 5 })).toBe(false);
  });
});

describe('findBlender', () => {
  it('uses BLENDER_PATH when it exists and never falls back past a wrong one', () => {
    const p = 'C:\\Users\\Not Your GURU\\blender.exe';
    expect(findBlender({ BLENDER_PATH: p }, 'win32', (x) => x === p)).toBe(p);
    expect(findBlender({ BLENDER_PATH: p }, 'win32', () => false)).toBeNull();
  });

  it('falls back to common install paths', () => {
    const want = 'C:\\Program Files\\Blender Foundation\\Blender 3.6\\blender.exe';
    expect(findBlender({}, 'win32', (x) => x === want)).toBe(want);
  });
});

describe('blenderArgs', () => {
  it('keeps paths with spaces and brackets as single arguments', () => {
    const script = 'C:\\Users\\Not Your GURU\\repo\\tools\\blender\\inspect.py';
    const packs = 'C:\\Users\\Not Your GURU\\packs\\Universal Base Characters[Standard]';
    const args = blenderArgs(script, { packsDir: packs });
    expect(args.slice(0, 6)).toEqual([
      '--background',
      '--factory-startup',
      '--python-exit-code',
      '1',
      '--python',
      script,
    ]);
    expect(args[6]).toBe('--');
    expect(JSON.parse(args[7] ?? '')).toEqual({ packsDir: packs });
  });
});

describe('artPaths', () => {
  it('defaults packs to art/packs and resolves relative overrides from the repo root', () => {
    const root = '/repo';
    expect(artPaths(root, undefined).packsDir.replaceAll('\\', '/')).toMatch(/\/repo\/art\/packs$/);
    expect(artPaths(root, 'my-packs').packsDir.replaceAll('\\', '/')).toMatch(/\/repo\/my-packs$/);
  });
});

describe('stepResultSchema', () => {
  it('rejects a result without the required fields', () => {
    expect(stepResultSchema.safeParse({ ok: true }).success).toBe(false);
    expect(
      stepResultSchema.safeParse({
        step: 'inspect',
        ok: true,
        skipped: false,
        seconds: 1.2,
        warnings: [],
        errors: [],
        stats: { found: [] },
      }).success,
    ).toBe(true);
  });
});
